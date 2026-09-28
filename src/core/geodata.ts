/**
 * geodata 补齐：内核缺 geoip.dat / geosite.dat 时会去 GitHub 下载，
 * 在受限网络下会直接导致启动失败，所以优先从应用内的 resources/geo 复制。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { resolveResourcePath } from '../util/paths.js';

const GEODATA_FILES = ['geoip.dat', 'geosite.dat', 'geoip.metadb', 'Country.mmdb'];

export function ensureGeodata(dataDir: string, appDir: string, log: Logger): void {
  const sourceDir = resolveResourcePath(appDir, 'resources/geo');
  for (const name of GEODATA_FILES) {
    const target = path.join(dataDir, name);
    if (fs.existsSync(target)) continue;

    const source = path.join(sourceDir, name);
    if (!fs.existsSync(source)) continue;

    fs.copyFileSync(source, target);
    log.info({ file: name }, '已从应用目录补齐 geodata');
  }
}
