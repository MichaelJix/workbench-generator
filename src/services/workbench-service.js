import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode, invariant } from '../core/errors.js';
import { parseSpec } from '../core/spec.js';
import { decodeWorkbench } from '../storage/database.js';

function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const result = target && typeof target === 'object' && !Array.isArray(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

export class WorkbenchService {
  constructor(store) { this.store = store; }

  create(user, rawSpec, note = 'initial') {
    const spec = parseSpec(rawSpec);
    const now = this.store.now();
    const workbench = {
      id: randomUUID(), userId: user.id, name: spec.name, slug: spec.slug || 'workbench',
      currentVersion: 1, createdAt: now, updatedAt: now
    };
    try {
      this.store.insertWorkbench(workbench, {
        workbenchId: workbench.id, version: 1, specJson: JSON.stringify(spec), note,
        createdBy: user.id, createdAt: now
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new AppError(ErrorCode.CONFLICT, `工作台 slug 已存在: ${workbench.slug}`);
      throw error;
    }
    this.store.audit(user.id, 'workbench.created', 'workbench', workbench.id, { version: 1 });
    return { ...workbench, spec };
  }

  get(user, id) {
    const row = this.store.getWorkbench(id, user.id);
    invariant(row, ErrorCode.NOT_FOUND, '工作台不存在');
    return decodeWorkbench(row, this.store.getWorkbenchVersion(id, row.current_version));
  }

  list(user) {
    return this.store.listWorkbenches(user.id).map((row) => decodeWorkbench(row));
  }

  revise(user, id, patch, note = 'revision') {
    return this.store.transaction(() => {
      const current = this.get(user, id);
      const spec = parseSpec(mergePatch(current.spec, patch));
      const version = current.currentVersion + 1;
      const now = this.store.now();
      this.store.insertWorkbenchVersion({
        workbenchId: id, version, specJson: JSON.stringify(spec), note, createdBy: user.id, createdAt: now
      });
      invariant(this.store.advanceWorkbench(id, user.id, spec.name, version, now) === 1, ErrorCode.CONFLICT, '工作台更新冲突');
      this.store.audit(user.id, 'workbench.revised', 'workbench', id, { version, note });
      return { ...current, name: spec.name, currentVersion: version, updatedAt: now, spec };
    });
  }

  rollback(user, id, targetVersion) {
    this.get(user, id);
    const target = this.store.getWorkbenchVersion(id, targetVersion);
    invariant(target, ErrorCode.NOT_FOUND, `工作台版本不存在: ${targetVersion}`);
    return this.replace(user, id, JSON.parse(target.spec_json), `rollback:${targetVersion}`);
  }

  replace(user, id, rawSpec, note = 'replacement') {
    return this.store.transaction(() => {
      const current = this.get(user, id);
      const spec = parseSpec(rawSpec);
      const version = current.currentVersion + 1;
      const now = this.store.now();
      this.store.insertWorkbenchVersion({
        workbenchId: id, version, specJson: JSON.stringify(spec), note, createdBy: user.id, createdAt: now
      });
      invariant(this.store.advanceWorkbench(id, user.id, spec.name, version, now) === 1, ErrorCode.CONFLICT, '工作台更新冲突');
      this.store.audit(user.id, 'workbench.replaced', 'workbench', id, { version, note });
      return { ...current, name: spec.name, currentVersion: version, updatedAt: now, spec };
    });
  }

  versions(user, id) {
    this.get(user, id);
    return this.store.listWorkbenchVersions(id);
  }
}
