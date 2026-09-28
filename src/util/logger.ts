/**
 * pino 日志：data/logs/app.log 按天轮转、保留 7 天。
 * 计划 §5.6 日志。
 */
import type { Logger } from 'pino';

export function createLogger(_dataDir: string): Logger {
  throw new Error('未实现：日志初始化');
}
