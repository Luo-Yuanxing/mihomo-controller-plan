/**
 * 原子落盘 + 热更新 PUT /providers/rules/custom。
 * 计划 §5.4 规则热更新（高频路径）。
 */
import type { CoreApi } from '../core/api.js';
import path from 'node:path';
import { t } from '../i18n.js';
import { readFileIfExists, writeFileAtomic } from '../util/atomic.js';
import type { RuleRepo } from './repo.js';
import { renderRuleProvider } from './render.js';

export interface SyncResult {
  changed: boolean;
  elapsedMs: number;
}

export async function syncRules(options: {
  repo: RuleRepo;
  api: CoreApi;
  dataDir: string;
  providerName: string;
  force?: boolean;
}): Promise<SyncResult> {
  const startedAt = Date.now();
  const file = path.join(options.dataDir, 'rules', `${options.providerName}.yaml`);
  const content = renderRuleProvider(options.repo.list());
  const current = await readFileIfExists(file);

  // 内容与磁盘一致则直接返回（幂等，计划 §5.4 第 4 步）
  if (options.force !== true && current === content) {
    return { changed: false, elapsedMs: Date.now() - startedAt };
  }

  await writeFileAtomic(file, content);
  try {
    await options.api.reloadRuleProvider(options.providerName);
  } catch (error) {
    throw new Error(
      t('rules.syncFailed', { error: error instanceof Error ? error.message : String(error) }),
    );
  }
  return { changed: true, elapsedMs: Date.now() - startedAt };
}
