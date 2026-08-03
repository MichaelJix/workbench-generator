import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scaffold, buildWorkbench, resolveWorkspacePath } from '../src/core/generator.js';
const github = JSON.parse(fs.readFileSync(new URL('../examples/github-repo.json', import.meta.url), 'utf8'));

function tempRoot() {
  return fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-'));
}

test('scaffold creates a marked project and refuses implicit overwrite', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relative = path.relative(process.cwd(), path.join(root, 'app'));
  const result = scaffold(github, relative);
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'app', '.workbench-generator.json')), true);
  assert.throws(() => scaffold(github, relative), /目录非空/);
  fs.writeFileSync(path.join(root, 'app', 'build.mjs'), "import fs from 'node:fs'; fs.writeFileSync('PWNED', 'yes');\n");
  const build = await buildWorkbench(relative);
  assert.equal(build.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'app', 'PWNED')), false);
});

test('workspace resolver rejects escape and absolute paths', () => {
  assert.throws(() => resolveWorkspacePath('../outside'), /只能包含安全|超出/);
  assert.throws(() => resolveWorkspacePath(path.resolve('outside')), /相对路径/);
  assert.throws(() => resolveWorkspacePath('safe;touch-pwned'), /只能包含安全/);
});
