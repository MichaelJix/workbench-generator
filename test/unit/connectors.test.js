import test from 'node:test';
import assert from 'node:assert/strict';
import { RestApiKeyAdapter } from '../../src/core/connectors/rest-adapter.js';
import { ConnectorRegistry } from '../../src/core/connectors/adapter.js';

const connector = {
  type: 'rest-apikey', baseUrl: 'https://api.example.com/v1',
  auth: { mode: 'header', env: 'EXAMPLE_KEY', header: 'X-API-Key' },
  endpoints: [{ id: 'item', path: '/items/{id}', method: 'GET' }],
  actions: [{ id: 'update', label: 'Update', path: '/items/{id}', method: 'PATCH', confirmation: 'Confirm update', input: [
    { name: 'id', label: 'ID', type: 'string', required: true },
    { name: 'enabled', label: 'Enabled', type: 'boolean', required: true }
  ] }]
};

test('REST adapter preserves base path, encodes params, and injects secrets late', () => {
  const adapter = new RestApiKeyAdapter();
  const read = adapter.buildReadRequest(connector, 'item', { id: 'a/b' }, { EXAMPLE_KEY: 'secret' });
  assert.equal(read.url.href, 'https://api.example.com/v1/items/a%2Fb');
  assert.equal(read.headers['X-API-Key'], 'secret');
  const write = adapter.buildActionRequest(connector, 'update', { id: '42', enabled: true }, {}, { EXAMPLE_KEY: 'secret' });
  assert.equal(write.method, 'PATCH');
  assert.equal(write.url.href, 'https://api.example.com/v1/items/42');
  assert.equal(JSON.parse(write.body).enabled, true);
});

test('REST adapter rejects missing secrets and invalid action input', () => {
  const adapter = new RestApiKeyAdapter();
  assert.throws(() => adapter.buildReadRequest(connector, 'item', { id: 1 }, {}), /EXAMPLE_KEY/);
  assert.throws(() => adapter.validateAction(connector, 'update', { id: '1' }), /enabled/);
  assert.throws(() => adapter.validateAction(connector, 'update', { id: '1', enabled: true, extra: 1 }), /未知/);
});

test('connector registry rejects duplicate and unknown adapters', () => {
  const registry = new ConnectorRegistry().register(new RestApiKeyAdapter());
  assert.throws(() => registry.register(new RestApiKeyAdapter()), /重复/);
  assert.throws(() => registry.get('missing'), /未知/);
});
