/**
 * 把 package.json 的版本号写进源码：打包后 npm_package_version 不存在，
 * 界面上的"应用版本号"就会退回硬编码的兜底值（曾经显示 0.1.0，与安装包对不上）。
 *
 * 因此开发与构建前都跑一次本脚本，src/version.ts 始终等于 package.json 的 version。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version ?? '0.0.0');

const target = path.join(root, 'src', 'version.ts');
const content = `/**
 * 应用版本号：由 scripts/gen-version.mjs 在开发/构建前从 package.json 生成。
 * 手改这个文件没有意义——下次启动或构建就会被覆盖。
 */
export const APP_VERSION = '${version}';
`;

if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) {
  process.stdout.write(`应用版本号已是 ${version}，无需改写 src/version.ts\n`);
} else {
  fs.writeFileSync(target, content, 'utf8');
  process.stdout.write(`应用版本号已写入 src/version.ts：${version}\n`);
}
