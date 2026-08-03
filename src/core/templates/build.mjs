// 可选构建：若装有 esbuild 则打包为 dist/src/main.js，否则直接跳过（server.mjs 直接托管 public/ 即可运行）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let esbuild;
try {
  esbuild = (await import('esbuild')).default;
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  console.log('ℹ️  未安装 esbuild，跳过打包。可直接运行：node server.mjs');
}
if (esbuild) {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'public/src/main.js')],
    bundle: true, format: 'esm', outfile: path.join(__dirname, 'dist/src/main.js'), charset: 'utf8'
  });
  console.log('✅ 已构建 dist/src/main.js');
}
