import { randomUUID } from 'node:crypto';
import { ErrorCode, invariant } from '../core/errors.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { decodeAction } from '../storage/database.js';

export class ActionService {
  constructor(store, workbenches, connectors, { executor, ttlSeconds = 600, env = {} } = {}) {
    this.store = store;
    this.workbenches = workbenches;
    this.connectors = connectors;
    this.executor = executor || (async () => { throw new Error('未配置 action executor'); });
    this.ttlSeconds = ttlSeconds;
    this.env = env;
  }

  request(user, { workbenchId, actionId, input = {} }) {
    const workbench = this.workbenches.get(user, workbenchId);
    const adapter = this.connectors.get(workbench.spec.connector.type);
    const definition = adapter.validateAction
      ? adapter.validateAction(workbench.spec.connector, actionId, input)
      : workbench.spec.connector.actions?.find((item) => item.id === actionId);
    invariant(definition, ErrorCode.NOT_FOUND, `action 不存在: ${actionId}`);
    const now = this.store.now();
    const value = {
      id: randomUUID(), userId: user.id, workbenchId, actionId, inputJson: JSON.stringify(input), status: 'pending',
      expiresAt: new Date(Date.parse(now) + this.ttlSeconds * 1000).toISOString(), createdAt: now
    };
    this.store.insertAction(value);
    this.store.audit(user.id, 'action.requested', 'action', value.id, { workbenchId, actionId, confirmation: definition.confirmation });
    return { ...decodeAction(this.store.getAction(value.id, user.id)), confirmation: definition.confirmation };
  }

  approve(user, id) {
    const action = this.#active(user, id, 'pending');
    const approvalToken = `approve_${randomToken()}`;
    invariant(this.store.approveAction(id, user.id, sha256(approvalToken), this.store.now()) === 1, ErrorCode.CONFLICT, '审批状态冲突');
    this.store.audit(user.id, 'action.approved', 'action', id, { workbenchId: action.workbenchId });
    return { action: decodeAction(this.store.getAction(id, user.id)), approvalToken };
  }

  reject(user, id) {
    this.#active(user, id, 'pending');
    invariant(this.store.rejectAction(id, user.id, this.store.now()) === 1, ErrorCode.CONFLICT, '审批状态冲突');
    this.store.audit(user.id, 'action.rejected', 'action', id);
    return decodeAction(this.store.getAction(id, user.id));
  }

  async execute(user, id, approvalToken) {
    const row = this.store.getAction(id, user.id);
    invariant(row, ErrorCode.NOT_FOUND, 'action 请求不存在');
    invariant(row.status === 'approved', ['executing', 'executed'].includes(row.status) ? ErrorCode.TOKEN_REUSED : ErrorCode.APPROVAL_REQUIRED, 'action 尚未批准或已经执行');
    invariant(Date.parse(row.expires_at) > Date.parse(this.store.now()), ErrorCode.EXPIRED, '审批请求已过期');
    const approvalHash = sha256(approvalToken || '');
    invariant(row.approval_hash === approvalHash, ErrorCode.FORBIDDEN, '审批票据无效');
    invariant(this.store.claimAction(id, user.id, approvalHash) === 1, ErrorCode.TOKEN_REUSED, '审批票据已被使用');
    try {
      const workbench = this.workbenches.get(user, row.workbench_id);
      const adapter = this.connectors.get(workbench.spec.connector.type);
      const request = adapter.buildActionRequest(workbench.spec.connector, row.action_id, JSON.parse(row.input_json), workbench.spec.params || {}, this.env);
      const result = await this.executor(request, { user, workbench, action: decodeAction(row) });
      invariant(this.store.finishAction(id, user.id, 'executed', result, this.store.now()) === 1, ErrorCode.CONFLICT, 'action 执行状态冲突');
      this.store.audit(user.id, 'action.executed', 'action', id, { status: 'executed' });
      return decodeAction(this.store.getAction(id, user.id));
    } catch (error) {
      this.store.finishAction(id, user.id, 'failed', { error: String(error.message || error).slice(0, 500) }, this.store.now());
      this.store.audit(user.id, 'action.failed', 'action', id, { error: String(error.message || error).slice(0, 200) });
      throw error;
    }
  }

  #active(user, id, status) {
    const action = decodeAction(this.store.getAction(id, user.id));
    invariant(action, ErrorCode.NOT_FOUND, 'action 请求不存在');
    invariant(action.status === status, ErrorCode.INVALID_STATE, `action 状态必须是 ${status}`);
    invariant(Date.parse(action.expiresAt) > Date.parse(this.store.now()), ErrorCode.EXPIRED, 'action 请求已过期');
    return action;
  }
}
