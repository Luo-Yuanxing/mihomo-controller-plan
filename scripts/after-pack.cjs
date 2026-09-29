/**
 * 打包后把主程序改成带版本号的文件名：代理控制面板-1.0.0.exe。
 * electron-builder 的 win.executableName 不做宏替换（appInfo.js 直接取字面量），
 * 所以版本号只能在这里补；改在 afterPack，dir 与 zip 两种产物都会带上。
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const base = packager.appInfo.productFilename;
  const from = path.join(appOutDir, `${base}.exe`);
  const to = path.join(appOutDir, `${base}-${packager.appInfo.version}.exe`);
  if (fs.existsSync(from)) fs.renameSync(from, to);
};
