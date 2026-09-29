/**
 * 单份订阅下载与校验，原子写入 data/subscription.yaml。
 * 计划 §4.2 订阅下载、§5.1 订阅（单份）。
 */
export interface SubscriptionOptions {
  url: string;
  useProxy: boolean;
  userAgent: string;
}

export interface DownloadResult {
  bytes: number;
  path: string;
  proxies: number;
}

import path from 'node:path';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { t } from '../i18n.js';
import { writeFileAtomic } from '../util/atomic.js';
import { isRecord, parseSubscription } from './subscription.js';

const TIMEOUT_MS = 20_000;

/**
 * 下载订阅并做最小校验（YAML 可解析且含 proxies / proxy-providers）。
 * 失败时保留旧文件并抛出错误，由调用方决定是否停止（计划 §5.1）。
 */
export async function downloadSubscription(
  options: SubscriptionOptions,
  dataDir: string,
  mixedPort: number,
): Promise<DownloadResult> {
  if (options.url.trim() === '') {
    throw new Error(t('sub.urlMissing'));
  }

  const dispatcher = options.useProxy ? new ProxyAgent(`http://127.0.0.1:${mixedPort}`) : undefined;
  const response = await undiciFetch(options.url, {
    headers: { 'user-agent': options.userAgent },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(dispatcher === undefined ? {} : { dispatcher }),
  });

  if (!response.ok) {
    throw new Error(t('sub.downloadFailed', { status: response.status }));
  }

  const text = (await response.text()).replace(/^\uFEFF/, '');
  const parsed = parseSubscription(text);
  const hasProviders =
    parsed.document !== null && isRecord(parsed.document['proxy-providers']);
  if (parsed.document === null) {
    throw new Error(t('sub.notYaml'));
  }
  if (parsed.proxies === 0 && !hasProviders) {
    throw new Error(t('sub.noProxies'));
  }

  const target = path.join(dataDir, 'subscription.yaml');
  await writeFileAtomic(target, text);
  return { bytes: Buffer.byteLength(text), path: target, proxies: parsed.proxies };
}
