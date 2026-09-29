/**
 * 取订阅文件里的 `dns` 段：本程序不自己编 DNS，直接沿用订阅那一套
 * （default-nameserver / fallback / nameserver-policy 等都原样带过）。
 */
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 订阅文件缺失、非法或没有 dns 段时返回 null，调用方回退到内置的最小 DNS 配置。 */
export function readSubscriptionDns(file: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let document: unknown;
  try {
    document = parseYaml(text);
  } catch {
    return null;
  }

  if (!isRecord(document)) return null;
  const dns = document['dns'];
  return isRecord(dns) ? dns : null;
}
