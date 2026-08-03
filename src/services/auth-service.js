import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode, invariant } from '../core/errors.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../security/crypto.js';

const DEFAULT_SCOPES = ['workbench:read', 'workbench:write', 'action:request', 'action:approve'];

export class AuthService {
  constructor(store) { this.store = store; }

  bootstrap(username, password) {
    invariant(this.store.countUsers() === 0, ErrorCode.CONFLICT, '系统已经完成初始化');
    return this.#createUserAndToken({ username, password, role: 'admin', scopes: [...DEFAULT_SCOPES, 'admin'] });
  }

  createUser(actor, { username, password, role = 'user' }) {
    invariant(actor?.role === 'admin', ErrorCode.FORBIDDEN, '只有管理员可以创建用户');
    const result = this.#createUserAndToken({ username, password, role, scopes: DEFAULT_SCOPES });
    this.store.audit(actor.id, 'user.created', 'user', result.user.id, { username, role });
    return result;
  }

  #createUserAndToken({ username, password, role, scopes }) {
    invariant(/^[A-Za-z0-9_.-]{3,64}$/.test(username || ''), ErrorCode.INVALID_INPUT, '用户名格式不合法');
    invariant(['admin', 'user'].includes(role), ErrorCode.INVALID_INPUT, '用户角色不合法');
    const { salt, hash } = hashPassword(password);
    const user = { id: randomUUID(), username, role, createdAt: this.store.now() };
    try {
      this.store.insertUser({ ...user, passwordHash: hash, passwordSalt: salt });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new AppError(ErrorCode.CONFLICT, '用户名已存在');
      throw error;
    }
    const token = this.issueToken(user, { name: 'initial', scopes });
    this.store.audit(user.id, 'user.bootstrap', 'user', user.id, { role });
    return { user, ...token };
  }

  login(username, password) {
    const row = this.store.getUserByUsername(username);
    invariant(row && verifyPassword(password, row.password_salt, row.password_hash), ErrorCode.UNAUTHENTICATED, '用户名或密码错误');
    const user = { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
    const scopes = user.role === 'admin' ? [...DEFAULT_SCOPES, 'admin'] : DEFAULT_SCOPES;
    this.store.audit(user.id, 'user.login', 'user', user.id);
    return { user, ...this.issueToken(user, { name: 'login', scopes, ttlSeconds: 86400 }) };
  }

  issueToken(user, { name = 'api', scopes = DEFAULT_SCOPES, ttlSeconds = 30 * 86400 } = {}) {
    const raw = `wb_${randomToken()}`;
    const createdAt = this.store.now();
    const expiresAt = ttlSeconds ? new Date(new Date(createdAt).getTime() + ttlSeconds * 1000).toISOString() : null;
    const id = randomUUID();
    this.store.insertToken({
      id, userId: user.id, name, tokenHash: sha256(raw), scopesJson: JSON.stringify([...new Set(scopes)]),
      expiresAt, createdAt
    });
    this.store.audit(user.id, 'token.created', 'token', id, { name, scopes, expiresAt });
    return { token: raw, tokenId: id, scopes, expiresAt };
  }

  authenticate(rawToken, requiredScope) {
    invariant(rawToken, ErrorCode.UNAUTHENTICATED, '缺少 Bearer token');
    const row = this.store.getTokenByHash(sha256(rawToken));
    invariant(row && !row.revoked_at, ErrorCode.UNAUTHENTICATED, 'token 无效或已撤销');
    invariant(!row.expires_at || Date.parse(row.expires_at) > Date.parse(this.store.now()), ErrorCode.UNAUTHENTICATED, 'token 已过期');
    const user = this.store.getUser(row.user_id);
    invariant(user, ErrorCode.UNAUTHENTICATED, 'token 用户不存在');
    const scopes = JSON.parse(row.scopes_json);
    if (requiredScope) invariant(scopes.includes(requiredScope) || scopes.includes('admin'), ErrorCode.FORBIDDEN, `缺少权限: ${requiredScope}`);
    this.store.touchToken(row.id);
    return { ...user, scopes, tokenId: row.id };
  }
}
