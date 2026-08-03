import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { scaffold } from '../src/core/generator.js';

const wechat = JSON.parse(fs.readFileSync(new URL('../examples/wechat-ops.json', import.meta.url), 'utf8'));

function waitForStart(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('工作台已启动')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early: ${code}`));
    });
  });
}

function rawStatus(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.end();
  });
}

test('generated server starts locally and exposes only a sanitized Spec', async (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  scaffold(wechat, path.relative(process.cwd(), app));
  const port = 43000 + (process.pid % 1000);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: app,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), WECHAT_APPID: '', WECHAT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGTERM'));
  await waitForStart(child);

  const publicSpec = await fetch(`http://127.0.0.1:${port}/spec.json`).then((r) => r.json());
  assert.deepEqual(publicSpec.connector, { type: 'wechat-mp', account: 'Michael' });
  const demo = await fetch(`http://127.0.0.1:${port}/api/connector/overview`).then((r) => r.json());
  assert.equal(demo.source, 'demo');
  assert.equal(await rawStatus(port, '/bad%ZZ'), 400);
});
