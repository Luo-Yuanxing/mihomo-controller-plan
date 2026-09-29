/**
 * pino 日志：data/logs/app.log 按天轮转、保留 7 天。
 * 计划 §5.6 日志。
 */
import fs from 'node:fs';
import path from 'node:path';
import pino, { type Logger } from 'pino';

const RETAIN_DAYS = 7;
const APP_PREFIX = 'app-';

function dayStamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function pruneOldLogs(logDir: string): void {
  const deadline = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(logDir)) {
    if (!name.startsWith(APP_PREFIX) || !name.endsWith('.log')) continue;
    const file = path.join(logDir, name);
    try {
      if (fs.statSync(file).mtimeMs < deadline) fs.rmSync(file, { force: true });
    } catch {
      // 清理失败不影响启动
    }
  }
}

export function logPaths(dataDir: string) {
  const logDir = path.join(dataDir, 'logs');
  return {
    dir: logDir,
    app: path.join(logDir, `${APP_PREFIX}${dayStamp()}.log`),
    core: path.join(logDir, 'core.log'),
  };
}

/** 订阅地址与 secret 打码后落盘（计划 §5.6）。 */
export function createLogger(dataDir: string): Logger {
  const paths = logPaths(dataDir);
  fs.mkdirSync(paths.dir, { recursive: true });
  pruneOldLogs(paths.dir);

  return pino(
    {
      level: process.env['MCP_LOG_LEVEL'] ?? 'info',
      base: null,
      redact: {
        paths: ['secret', '*.secret', 'url', '*.url', 'settings.subscription.url'],
        censor: '***',
      },
    },
    pino.destination({ dest: paths.app, mkdir: true, sync: false }),
  );
}

export function tailLines(file: string, maxLines: number): string[] {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    return lines.filter((line) => line.trim() !== '').slice(-maxLines);
  } catch {
    return [];
  }
}
