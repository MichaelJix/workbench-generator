import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../../src/storage/database.js';
import { createServices } from '../../src/services/index.js';

const config = {
  databasePath: ':memory:', masterKey: 'm'.repeat(32), oauthProvidersJson: '{}', allowPrivateUpstream: true
};

function setup(overrides = {}) {
  const store = new SqliteStore(':memory:');
  return createServices(config, { store, ...overrides });
}

test('authentication, interview persistence, versioning, rollback, and tenant isolation', () => {
  const services = setup();
  try {
    const adminResult = services.auth.bootstrap('admin', 'admin-password-123');
    const admin = services.auth.authenticate(adminResult.token);
    assert.equal(admin.role, 'admin');
    assert.throws(() => services.auth.bootstrap('again', 'another-password'), /初始化/);

    const otherResult = services.auth.createUser(admin, { username: 'other', password: 'other-password-123' });
    const other = services.auth.authenticate(otherResult.token);

    let interview = services.interviews.start(admin, '做一个 GitHub 仓库工作台');
    assert.equal(interview.status, 'collecting');
    interview = services.interviews.answer(admin, interview.id, {
      repository: 'openai/openai-node', auth: 'none', sample: ''
    });
    assert.equal(interview.status, 'ready');
    const completed = services.interviews.finalize(admin, interview.id);
    assert.equal(completed.interview.status, 'completed');
    assert.equal(completed.workbench.spec.specVersion, 1);
    assert.equal(services.workbenches.list(admin).length, 1);
    assert.throws(() => services.workbenches.get(other, completed.workbench.id), /不存在/);

    const revised = services.workbenches.revise(admin, completed.workbench.id, { name: 'Revised', theme: null }, 'rename');
    assert.equal(revised.currentVersion, 2);
    assert.equal(revised.spec.theme, undefined);
    const rolled = services.workbenches.rollback(admin, completed.workbench.id, 1);
    assert.equal(rolled.currentVersion, 3);
    assert.equal(rolled.spec.theme.brand, '#181717');
    assert.deepEqual(services.workbenches.versions(admin, completed.workbench.id).map((v) => v.version), [3, 2, 1]);
  } finally { services.store.close(); }
});

test('write actions require valid input, explicit approval, and a one-time token', async () => {
  const requests = [];
  const services = setup({
    env: { EXAMPLE_KEY: 'runtime-secret' },
    executor: async (request) => { requests.push(request); return { status: 200, data: { updated: true } }; }
  });
  try {
    const bootstrap = services.auth.bootstrap('admin', 'admin-password-123');
    const user = services.auth.authenticate(bootstrap.token);
    const workbench = services.workbenches.create(user, {
      specVersion: 1, name: 'Actions', slug: 'actions',
      connector: {
        type: 'rest-apikey', baseUrl: 'https://api.example.com/v1', auth: { mode: 'header', env: 'EXAMPLE_KEY', header: 'X-API-Key' },
        endpoints: [{ id: 'data', path: '/data', method: 'GET' }],
        actions: [{ id: 'update', label: 'Update', path: '/items/{id}', method: 'PATCH', confirmation: 'Update this item?', input: [
          { name: 'id', label: 'ID', type: 'string', required: true },
          { name: 'enabled', label: 'Enabled', type: 'boolean', required: true }
        ] }]
      },
      pages: [{ id: 'home', title: 'Home', widgets: [{ type: 'kpi', label: 'Value', endpoint: 'data', field: 'value' }] }]
    });
    assert.throws(() => services.actions.request(user, { workbenchId: workbench.id, actionId: 'update', input: { id: '1' } }), /enabled/);
    const pending = services.actions.request(user, { workbenchId: workbench.id, actionId: 'update', input: { id: '1', enabled: true } });
    await assert.rejects(() => services.actions.execute(user, pending.id, 'not-approved'), /尚未批准/);
    const approved = services.actions.approve(user, pending.id);
    const executed = await services.actions.execute(user, pending.id, approved.approvalToken);
    assert.equal(executed.status, 'executed');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers['X-API-Key'], 'runtime-secret');
    await assert.rejects(() => services.actions.execute(user, pending.id, approved.approvalToken), (error) => error.code === 'TOKEN_REUSED');
  } finally { services.store.close(); }
});

test('concurrent action execution atomically consumes the approval before side effects', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const services = setup({ executor: async () => { calls += 1; await gate; return { status: 200 }; } });
  try {
    const bootstrap = services.auth.bootstrap('admin', 'admin-password-123');
    const user = services.auth.authenticate(bootstrap.token);
    const workbench = services.workbenches.create(user, {
      specVersion: 1, name: 'Race', slug: 'race',
      connector: { type: 'rest-apikey', baseUrl: 'https://api.example.com', auth: null,
        endpoints: [{ id: 'data', path: '/data', method: 'GET' }],
        actions: [{ id: 'run', label: 'Run', path: '/run', method: 'POST', confirmation: 'Run?', input: [] }] },
      pages: [{ id: 'home', title: 'Home', widgets: [{ type: 'kpi', label: 'Value', endpoint: 'data', field: 'value' }] }]
    });
    const pending = services.actions.request(user, { workbenchId: workbench.id, actionId: 'run' });
    const approved = services.actions.approve(user, pending.id);
    const first = services.actions.execute(user, pending.id, approved.approvalToken);
    await assert.rejects(() => services.actions.execute(user, pending.id, approved.approvalToken), (error) => error.code === 'TOKEN_REUSED');
    assert.equal(calls, 1);
    release();
    assert.equal((await first).status, 'executed');
  } finally { services.store.close(); }
});

test('SQLite data and token authentication survive a process-style reopen', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-store-'));
  const filename = path.join(directory, 'workbench.db');
  let store = new SqliteStore(filename);
  let token;
  try {
    const services = createServices({ ...config, databasePath: filename }, { store });
    const bootstrap = services.auth.bootstrap('admin', 'admin-password-123');
    token = bootstrap.token;
    services.workbenches.create(services.auth.authenticate(token), {
      specVersion: 1, name: 'Persistent', slug: 'persistent',
      connector: { type: 'rest-apikey', baseUrl: 'https://api.example.com', auth: null, endpoints: [{ id: 'data', path: '/data', method: 'GET' }] },
      pages: [{ id: 'home', title: 'Home', widgets: [{ type: 'kpi', label: 'Value', endpoint: 'data', field: 'value' }] }]
    });
    store.close();
    store = new SqliteStore(filename);
    const reopened = createServices({ ...config, databasePath: filename }, { store });
    const user = reopened.auth.authenticate(token);
    assert.equal(reopened.workbenches.list(user).length, 1);
  } finally {
    try { store.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
