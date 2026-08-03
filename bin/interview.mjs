#!/usr/bin/env node
// 交互式访谈 CLI：一句话 -> 追问 -> 生成工作台项目。
// 用法: node bin/interview.mjs "做一个 GitHub 仓库星标看板"
// 支持管道喂答案（非 TTY 时先读入全部输入入队，用尽再回退交互提问），便于脚本化测试。
import { analyzePrompt, buildSpec } from '../src/core/interview.js';
import { scaffold } from '../src/core/generator.js';
import readline from 'node:readline';
import fs from 'node:fs';

const prompt = process.argv.slice(2).join(' ').trim();
if (!prompt) {
  console.error('用法: node bin/interview.mjs "一句话需求，例如：做一个 GitHub 仓库星标看板"');
  process.exit(1);
}

// 预读管道输入（非 TTY）
let queue = [];
if (!process.stdin.isTTY) {
  try { queue = fs.readFileSync(0, 'utf8').split(/\r?\n/).map((s) => s.trim()); } catch { queue = []; }
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askInteractive = (q) => new Promise((res) => rl.question(q + '\n> ', (a) => res(a.trim())));

function chooseFromOptions(options, multi, raw) {
  const idxs = String(raw).split(/[,\s]+/).map((x) => parseInt(x, 10) - 1).filter((i) => i >= 0 && i < options.length);
  if (!idxs.length) return multi ? (options.default || []) : (options.default ?? (options[0].value ?? options[0]));
  const vals = idxs.map((i) => (typeof options[i] === 'string' ? options[i] : (options[i].value ?? options[i].label)));
  return multi ? vals : vals[0];
}

async function getAnswer(qu) {
  if (queue.length) {
    const raw = queue.shift();
    if (qu.type === 'choice') return chooseFromOptions(qu.options, qu.multi, raw);
    return raw;
  }
  if (qu.type === 'choice') {
    const lines = qu.options.map((o, i) => `  ${i + 1}. ${typeof o === 'string' ? o : o.label}${o.note ? ' — ' + o.note : ''}`).join('\n');
    console.log('\n' + qu.q);
    console.log(lines);
    const raw = await askInteractive('输入编号' + (qu.multi ? '(可多选，逗号分隔)' : ''));
    return chooseFromOptions(qu.options, qu.multi, raw);
  }
  return askInteractive('\n' + qu.q + (qu.hint ? `  (${qu.hint})` : ''));
}

(async () => {
  const plan = analyzePrompt(prompt);
  console.log(`\n🔍 识别为数据源: ${plan.presetLabel}（平台: ${plan.platform}）`);
  const answers = {};
  for (const qu of plan.questions) answers[qu.id] = await getAnswer(qu);
  const spec = buildSpec(prompt, answers);
  const out = './' + (spec.slug || 'workbench');
  try {
    const r = scaffold(spec, out);
    console.log('\n✅ 已生成工作台 ->', r.outDir);
    console.log('   运行: cd', r.outDir, '&& node server.mjs');
    console.log('   浏览器: http://localhost:3000');
  } catch (e) {
    console.error('\n❌ 生成失败:', e.message);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
})();
