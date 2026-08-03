import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSpec } from '../../src/core/spec-migrations.js';
import { parseSpec, validateSpec } from '../../src/core/spec.js';
import { AppError, ErrorCode, asAppError } from '../../src/core/errors.js';

const legacy = {
  name: 'Legacy',
  connector: { type: 'rest-apikey', baseUrl: 'https://api.example.com', endpoints: [{ id: 'data', path: '/data' }] },
  pages: [{ id: 'home', title: 'Home', widgets: [{ type: 'kpi', label: 'Value', endpoint: 'data', field: 'value' }] }]
};

test('legacy specs migrate deterministically to v1', () => {
  const migrated = migrateSpec(legacy);
  assert.equal(migrated.toVersion, 1);
  assert.deepEqual(migrated.applied, ['0->1']);
  assert.equal(migrated.spec.connector.endpoints[0].method, 'GET');
  assert.equal(parseSpec(legacy).specVersion, 1);
  assert.equal(Object.hasOwn(legacy, 'specVersion'), false);
});

test('future and structurally invalid specs are rejected', () => {
  assert.equal(validateSpec({ ...legacy, specVersion: 99 }).ok, false);
  assert.throws(() => parseSpec({ ...legacy, specVersion: 99 }), (error) => error.code === ErrorCode.INVALID_SPEC);
  assert.equal(validateSpec({ ...legacy, connector: { ...legacy.connector, baseUrl: 'http://localhost' } }).ok, false);
});

test('application errors keep stable status and unknown errors are hidden', () => {
  const error = new AppError(ErrorCode.NOT_FOUND, 'missing', { id: 1 });
  assert.equal(error.status, 404);
  assert.equal(asAppError(error), error);
  const hidden = asAppError(new Error('database secret'));
  assert.equal(hidden.code, ErrorCode.INTERNAL);
  assert.equal(hidden.message, '内部错误');
});
