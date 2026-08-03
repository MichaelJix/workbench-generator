import test from 'node:test';
import assert from 'node:assert/strict';
import { getPath } from '../src/core/templates/public/src/components.js';

test('getPath supports dot and bracket array notation', () => {
  const value = { available: [{ amount: 123 }] };
  assert.equal(getPath(value, 'available.0.amount'), 123);
  assert.equal(getPath(value, 'available[0].amount'), 123);
});
