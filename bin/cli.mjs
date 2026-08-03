#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);

if (!command || ['-h', '--help', 'help'].includes(command)) {
  console.log(`workbench-generator

用法:
  workbench-generator mcp
  workbench-generator serve
  workbench-generator init <admin-username>
  workbench-generator create <spec.json> [-o outDir] [--force]
  workbench-generator interview "一句话需求"
`);
  process.exit(0);
}

if (command === 'mcp') {
  await import('../src/mcp/server.mjs');
} else if (command === 'serve') {
  await import('./server.mjs');
} else if (command === 'init') {
  const username = args[0] || 'admin';
  const password = process.env.WORKBENCH_ADMIN_PASSWORD;
  if (!password) throw new Error('请通过 WORKBENCH_ADMIN_PASSWORD 提供初始密码');
  const { loadConfig } = await import('../src/server/config.js');
  const { createServices } = await import('../src/services/index.js');
  const services = createServices(loadConfig());
  try { console.log(JSON.stringify(services.auth.bootstrap(username, password), null, 2)); }
  finally { services.store.close(); }
} else if (command === 'create' || command === 'interview') {
  const script = command === 'create' ? 'create-workbench.mjs' : 'interview.mjs';
  const child = spawn(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit' });
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
} else {
  console.error(`未知命令: ${command}`);
  process.exit(1);
}
