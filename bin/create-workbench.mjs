#!/usr/bin/env node
// CLI: create-workbench <spec.json> [-o outDir]
// 根据一份 Spec 生成一套可运行的工作台项目。
import { scaffold } from '../src/core/generator.js';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const specArg = argv.find((a) => !a.startsWith('-'));
const outIdx = argv.indexOf('-o');
const outArg = outIdx >= 0 ? argv[outIdx + 1] : null;
const overwrite = argv.includes('--force');

if (!specArg) {
  console.error('用法: create-workbench <spec.json> [-o outDir] [--force]');
  console.error('示例: create-workbench examples/github-repo.json -o ./my-dash');
  process.exit(1);
}

let spec;
try { spec = JSON.parse(fs.readFileSync(specArg, 'utf8')); }
catch (e) { console.error('❌ 无法读取 spec:', e.message); process.exit(1); }

const outDir = outArg || './' + (spec.slug || 'workbench');
try {
  const r = scaffold(spec, outDir, { overwrite });
  console.log('✅ 已生成工作台 ->', r.outDir);
  console.log('   运行: cd', r.outDir, '&& node server.mjs');
  console.log('   浏览器打开: http://localhost:3000');
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
