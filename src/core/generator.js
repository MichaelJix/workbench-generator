import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpec } from './spec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.join(__dirname, 'templates');
const MARKER = '.workbench-generator.json';

function copyDir(src, dst, skip = []) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const source = path.join(src, entry.name);
    const target = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyDir(source, target, skip);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

export function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workbench';
}

function assertNoSymlinkComponents(root, target) {
  const rel = path.relative(root, target);
  let cursor = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('输出路径不得经过符号链接');
  }
}

export function resolveWorkspacePath(input, { mustExist = false } = {}) {
  if (!input || typeof input !== 'string') throw new Error('目录必须是非空字符串');
  if (path.isAbsolute(input)) throw new Error('仅允许当前工作区内的相对路径');
  const normalizedInput = input.replace(/^\.([\\/])/, '');
  const parts = normalizedInput.split(/[\\/]/);
  if (!normalizedInput || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === '.' || part === '..')) {
    throw new Error('目录只能包含安全的字母、数字、点、下划线、连字符和路径分隔符');
  }
  const root = fs.realpathSync(process.cwd());
  const target = path.resolve(root, normalizedInput);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('目录超出当前工作区');
  assertNoSymlinkComponents(root, target);
  if (mustExist && !fs.existsSync(target)) throw new Error('目录不存在');
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    if (real === root || !real.startsWith(root + path.sep)) throw new Error('目录超出当前工作区');
  }
  return target;
}

export function scaffold(rawSpec, outDir, { overwrite = false } = {}) {
  const spec = parseSpec(rawSpec);
  const absOut = resolveWorkspacePath(outDir);
  if (fs.existsSync(absOut)) {
    const entries = fs.readdirSync(absOut);
    if (entries.length && !overwrite) throw new Error('输出目录非空；如需覆盖请显式设置 overwrite=true 或使用 --force');
  }
  fs.mkdirSync(absOut, { recursive: true });
  copyDir(TPL, absOut, ['spec.json']);
  fs.writeFileSync(path.join(absOut, 'spec.json'), JSON.stringify(spec, null, 2) + '\n');
  fs.writeFileSync(path.join(absOut, MARKER), JSON.stringify({ formatVersion: 1, generator: 'workbench-generator' }, null, 2) + '\n');

  const pkgPath = path.join(absOut, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = spec.slug || slugify(spec.name);
  pkg.description = spec.name + ' 工作台（由 workbench-generator 生成）';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return { ok: true, outDir: path.relative(process.cwd(), absOut) || '.', name: pkg.name };
}

export async function buildWorkbench(projectDir, { signal } = {}) {
  const abs = resolveWorkspacePath(projectDir, { mustExist: true });
  const markerPath = path.join(abs, MARKER);
  if (!fs.existsSync(markerPath)) throw new Error('不是由本工具生成的工作台（缺少生成标记）');
  if (signal?.aborted) throw new Error('构建已取消');

  let esbuild;
  try {
    esbuild = (await import('esbuild')).default;
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return { ok: true, built: false, reason: '未安装 esbuild；工作台可直接运行' };
  }
  await esbuild.build({
    entryPoints: [path.join(abs, 'public/src/main.js')],
    bundle: true,
    format: 'esm',
    outfile: path.join(abs, 'dist/src/main.js'),
    charset: 'utf8',
    logLevel: 'silent'
  });
  if (signal?.aborted) throw new Error('构建已取消');
  return { ok: true, built: true, output: path.join(path.relative(process.cwd(), abs), 'dist/src/main.js') };
}
