import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SqliteStore } from '../../src/storage/database.js';
import { createServices } from '../../src/services/index.js';
import { createHttpServer } from '../../src/server/http-server.js';

async function startServer() {
  const config = {
    host: '127.0.0.1', port: 0, databasePath: ':memory:', masterKey: 'g'.repeat(32),
    oauthProvidersJson: '{}', allowedOrigins: ['http://client.example'], allowPrivateUpstream: true,
    publicBaseUrl: 'http://127.0.0.1'
  };
  const store = new SqliteStore(':memory:');
  const services = createServices(config, { store, executor: async () => ({ status: 200, data: {} }) });
  const server = createHttpServer(config, services);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return { server, services, base: `http://127.0.0.1:${address.port}` };
}

async function api(base, pathname, { token, method = 'GET', data, origin } = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {})
  });
  return { status: response.status, body: await response.json() };
}

test('self-hosted HTTP API supports bootstrap, interview, persistence, and audit', async () => {
  const app = await startServer();
  try {
    const health = await api(app.base, '/health');
    assert.equal(health.status, 200);
    const unauthenticated = await api(app.base, '/api/workbenches');
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error.code, 'UNAUTHENTICATED');

    const bootstrap = await api(app.base, '/api/bootstrap', {
      method: 'POST', data: { username: 'admin', password: 'admin-password-123' }
    });
    assert.equal(bootstrap.status, 201);
    const token = bootstrap.body.data.token;
    const malformed = await api(app.base, '/api/login', {
      method: 'POST', data: { username: 'admin', password: 'admin-password-123', unexpected: true }
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'INVALID_INPUT');
    const readOnly = app.services.auth.issueToken(bootstrap.body.data.user, { scopes: ['workbench:read'] });
    const forbidden = await api(app.base, '/api/interviews', {
      token: readOnly.token, method: 'POST', data: { prompt: 'should fail' }
    });
    assert.equal(forbidden.status, 403);
    const started = await api(app.base, '/api/interviews', {
      token, method: 'POST', data: { prompt: '做一个 GitHub 仓库工作台' }
    });
    const interviewId = started.body.data.id;
    const answered = await api(app.base, `/api/interviews/${interviewId}/answers`, {
      token, method: 'POST', data: { answers: { repository: 'openai/openai-node', auth: 'none', sample: '' } }
    });
    assert.equal(answered.body.data.status, 'ready');
    const finalized = await api(app.base, `/api/interviews/${interviewId}/finalize`, { token, method: 'POST', data: {} });
    assert.equal(finalized.status, 201);
    const listed = await api(app.base, '/api/workbenches', { token });
    assert.equal(listed.body.data.length, 1);
    const audit = await api(app.base, '/api/audit?limit=10', { token });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.data.some((row) => row.event_type === 'interview.completed'), true);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.services.store.close();
  }
});

test('remote Streamable HTTP MCP authenticates and exposes stateful tools', async () => {
  const app = await startServer();
  let client;
  try {
    const bootstrap = await api(app.base, '/api/bootstrap', {
      method: 'POST', data: { username: 'admin', password: 'admin-password-123' }
    });
    const token = bootstrap.body.data.token;
    const denied = await fetch(`${app.base}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bad', version: '1' } } })
    });
    assert.equal(denied.status, 403);

    client = new Client({ name: 'global-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${app.base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}`, Origin: 'http://client.example' } }
    });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.some((tool) => tool.name === 'workbench_list'), true);
    assert.equal(listed.tools.some((tool) => tool.name === 'scaffold_workbench'), false);
    const result = await client.callTool({ name: 'workbench_list', arguments: {} });
    assert.deepEqual(result.structuredContent.result, []);
  } finally {
    if (client) await client.close().catch(() => {});
    await new Promise((resolve) => app.server.close(resolve));
    app.services.store.close();
  }
});
