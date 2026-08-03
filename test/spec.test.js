import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSpec } from '../src/core/spec.js';
const github = JSON.parse(fs.readFileSync(new URL('../examples/github-repo.json', import.meta.url), 'utf8'));
const wechat = JSON.parse(fs.readFileSync(new URL('../examples/wechat-ops.json', import.meta.url), 'utf8'));

test('GitHub example passes the strict schema', () => {
  assert.equal(validateSpec(github).ok, true);
  assert.equal(validateSpec(wechat).ok, true);
});

test('write action example passes the strict schema', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../examples/action-workbench.json', import.meta.url), 'utf8'));
  const result = validateSpec(spec);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.data.connector.actions[0].method, 'POST');
});

test('plaintext credentials and secret headers are rejected', () => {
  const withSecret = structuredClone(github);
  withSecret.connector.secret = 'do-not-publish';
  assert.equal(validateSpec(withSecret).ok, false);

  const withHeader = structuredClone(github);
  withHeader.connector.headers.Authorization = 'Bearer plaintext';
  assert.equal(validateSpec(withHeader).ok, false);
});

test('unknown endpoint references and incomplete charts are rejected', () => {
  const unknown = structuredClone(github);
  unknown.pages[0].widgets[0].endpoint = 'missing';
  assert.match(validateSpec(unknown).errors.join('\n'), /不存在的 endpoint/);

  const chart = structuredClone(github);
  chart.pages[1].widgets[0] = {
    type: 'lineChart', endpoint: 'traffic', arrayField: 'views', series: [{ name: 'x', field: 'count' }]
  };
  assert.equal(validateSpec(chart).ok, false);
});
