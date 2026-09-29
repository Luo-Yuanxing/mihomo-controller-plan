/**
 * 打包前置检查：resources/bin/mihomo.exe 要随包分发（作为预设内核版本），
 * 它不入库，所以在干净克隆上很容易漏装——漏了就报错退出，别发一个没有内核的包。
 */
import fs from 'node:fs';
import path from 'node:path';

const target = path.join('resources', 'bin', 'mihomo.exe');

let stat;
try {
  stat = fs.statSync(target);
} catch {
  console.error(`缺少内核二进制：${target}（resources/bin 不入库，打包前必须放好）`);
  process.exit(1);
}

console.log(`内核二进制就位：${target}（${(stat.size / 1024 / 1024).toFixed(1)} MB）`);
