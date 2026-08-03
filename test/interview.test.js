import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePrompt, buildSpec, introspectSample } from '../src/core/interview.js';

test('Shopify and Stripe presets preserve their API base paths', () => {
  const shopify = buildSpec('做一个 Shopify 订单看板', { shop: 'my-store', auth: 'bearer' });
  assert.equal(shopify.connector.baseUrl, 'https://my-store.myshopify.com/admin/api/2026-07');
  assert.equal(shopify.connector.endpoints[0].path, '/shop.json');

  const stripe = buildSpec('做一个 Stripe 余额看板', { auth: 'bearer' });
  assert.equal(stripe.connector.baseUrl, 'https://api.stripe.com/v1');
  assert.equal(stripe.pages[0].widgets[0].field, 'available.0.amount');
});

test('interview only asks questions that are used by the builder', () => {
  const github = analyzePrompt('做一个 GitHub 仓库看板');
  assert.deepEqual(github.questions.map((q) => q.id), ['repository', 'auth', 'sample']);
  const custom = analyzePrompt('给我的自定义接口做工作台');
  assert.deepEqual(custom.questions.map((q) => q.id), ['baseUrl', 'dataPath', 'auth', 'sample']);
});

test('sample introspection is bounded and reports invalid JSON', () => {
  assert.match(introspectSample('{broken').error, /解析失败/);
  assert.match(introspectSample('x'.repeat(1_000_001)).error, /1 MB/);
});
