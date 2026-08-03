import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode, invariant } from '../core/errors.js';
import { analyzePrompt, buildSpec } from '../core/interview.js';
import { decodeInterview } from '../storage/database.js';

export class InterviewService {
  constructor(store, workbenches) {
    this.store = store;
    this.workbenches = workbenches;
  }

  start(user, prompt) {
    invariant(typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 2000, ErrorCode.INVALID_INPUT, 'prompt 长度必须为 1-2000');
    const plan = analyzePrompt(prompt.trim());
    const now = this.store.now();
    const value = {
      id: randomUUID(), userId: user.id, prompt: prompt.trim(), platform: plan.platform, status: 'collecting',
      questionsJson: JSON.stringify(plan.questions), answersJson: '{}', specJson: null, createdAt: now, updatedAt: now
    };
    this.store.insertInterview(value);
    this.store.audit(user.id, 'interview.started', 'interview', value.id, { platform: plan.platform });
    return decodeInterview(this.store.getInterview(value.id, user.id));
  }

  get(user, id) {
    const value = decodeInterview(this.store.getInterview(id, user.id));
    invariant(value, ErrorCode.NOT_FOUND, '访谈不存在');
    return value;
  }

  answer(user, id, answers) {
    const interview = this.get(user, id);
    invariant(interview.status === 'collecting' || interview.status === 'ready', ErrorCode.INVALID_STATE, '访谈已经完成');
    invariant(answers && typeof answers === 'object' && !Array.isArray(answers), ErrorCode.INVALID_INPUT, 'answers 必须是对象');
    const allowed = new Set(interview.questions.map((question) => question.id));
    for (const key of Object.keys(answers)) invariant(allowed.has(key), ErrorCode.INVALID_INPUT, `未知问题答案: ${key}`);
    const merged = { ...interview.answers, ...answers };
    const complete = interview.questions.every((question) => Object.hasOwn(merged, question.id));
    const status = complete ? 'ready' : 'collecting';
    this.store.updateInterview(id, user.id, {
      status, answersJson: JSON.stringify(merged), specJson: interview.spec ? JSON.stringify(interview.spec) : null, updatedAt: this.store.now()
    });
    this.store.audit(user.id, 'interview.answered', 'interview', id, { keys: Object.keys(answers), complete });
    return this.get(user, id);
  }

  finalize(user, id) {
    const interview = this.get(user, id);
    invariant(interview.status === 'ready', ErrorCode.INVALID_STATE, '仍有问题未回答');
    const spec = buildSpec(interview.prompt, { ...interview.answers, platform: interview.platform });
    const workbench = this.workbenches.create(user, spec, `interview:${id}`);
    this.store.updateInterview(id, user.id, {
      status: 'completed', answersJson: JSON.stringify(interview.answers), specJson: JSON.stringify(spec), updatedAt: this.store.now()
    });
    this.store.audit(user.id, 'interview.completed', 'interview', id, { workbenchId: workbench.id });
    return { interview: this.get(user, id), workbench };
  }
}
