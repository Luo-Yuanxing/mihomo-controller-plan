/**
 * 单份订阅下载与校验，原子写入 data/subscription.yaml。
 * 计划 §4.2 订阅下载、§5.1 订阅（单份）。
 */
export interface SubscriptionOptions {
  url: string;
  interval: number;
  useProxy: boolean;
  userAgent: string;
}

export interface DownloadResult {
  bytes: number;
  path: string;
  proxies: number;
}

import path from 'node:path';
import fs from 'node:fs';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { parse as parseYaml } from 'yaml';
import { writeFileAtomic } from '../util/atomic.js';

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
    throw new Error('订阅 URL 未配置');
  }

  const dispatcher = options.useProxy ? new ProxyAgent(`http://127.0.0.1:${mixedPort}`) : undefined;
  const response = await undiciFetch(options.url, {
    headers: { 'user-agent': options.userAgent },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(dispatcher === undefined ? {} : { dispatcher }),
  });

  if (!response.ok) {
    throw new Error(`订阅下载失败：HTTP ${response.status}`);
  }

  const text = (await response.text()).replace(/^\uFEFF/, '');
  let payload: unknown;
  try {
    payload = parseYaml(text);
  } catch (error) {
    throw new Error(`订阅不是合法 YAML：${error instanceof Error ? error.message : String(error)}`);
  }

  const document = payload as Record<string, unknown> | null;
  const proxies = Array.isArray(document?.['proxies']) ? document['proxies'].length : 0;
  const hasProviders =
    typeof document?.['proxy-providers'] === 'object' && document['proxy-providers'] !== null;
  if (proxies === 0 && !hasProviders) {
    throw new Error('订阅内容缺少 proxies / proxy-providers 字段');
  }

  const target = path.join(dataDir, 'subscription.yaml');
  await writeFileAtomic(target, text);
  return { bytes: Buffer.byteLength(text), path: target, proxies };
}

/**
 * 统计订阅文件里的可用节点数。
 * 文件不存在、YAML 不合法、proxies 为空一律返回 0：空订阅不能当"有订阅"用，
 * 否则 PROXY 组会退化成 mihomo 的 emptyFallback(COMPATIBLE)，即静默直连。
 */
export function countSubscriptionProxies(file: string): number {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  try {
    const document = parseYaml(text) as Record<string, unknown> | null;
    return Array.isArray(document?.['proxies']) ? document['proxies'].length : 0;
  } catch {
    return 0;
  }
}
