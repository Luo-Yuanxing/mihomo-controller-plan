/**
 * 原子落盘 + 热更新 PUT /providers/rules/custom。
 * 计划 §5.4 规则热更新（高频路径）。
 */
import type { CoreApi } from '../core/api.js';
import type { RuleRepo } from './repo.js';

export interface SyncResult {
  changed: boolean;
  elapsedMs: number;
}

export async function syncRules(_options: {
  repo: RuleRepo;
  api: CoreApi;
  dataDir: string;
  providerName: string;
  force?: boolean;
}): Promise<SyncResult> {
  throw new Error('未实现：规则落盘与热更新');
}
