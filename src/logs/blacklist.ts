/**
 * 失败连接的黑名单：按主机名匹配，命中的目标不进面板列表。
 *
 * 只在主机名这一层过滤（日志与连接采样都是按域名判定失败），一条一个主机，
 * 支持 `*.example.com` 这种只匹配子域的通配写法（`example.com` 自己仍会显示）。
 */
import { z } from 'zod';
import { t } from '../i18n.js';

/** 主机串的上限：允许 IPv6 字面量与端口括号，但挡住明显的乱填；通配只在 `*.` 前缀这一处。 */
const HOST_PATTERN = /^\*?\.[\w.:%[\]-]+$|^[\w.:%[\]-]+$/;

/** 黑名单条数上限：再多就该改用规则了，规则库才是长期拦截的地方。 */
export const MAX_BLACKLIST_HOSTS = 500;
const MAX_HOST_LENGTH = 200;

/** 单个主机的归一化形态：去空白、转小写，`*.` 前缀原样保留。 */
export function canonicalHost(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 把通配前缀展开成匹配形态：
 * `*.example.com` 只匹配子域（self: false），`example.com` 只匹配它自己（self: true）。
 */
function patternForms(pattern: string): { suffix: string; self: boolean } {
  if (pattern.startsWith('*.')) return { suffix: pattern.slice(2), self: false };
  return { suffix: pattern, self: true };
}

function isValidHostPattern(pattern: string): boolean {
  if (pattern === '' || pattern.length > MAX_HOST_LENGTH) return false;
  // 星号只允许出现在 `*.` 前缀里：`*`、`*.`、`a*.b`、`example.*` 都被这条与字符集挡下
  return HOST_PATTERN.test(pattern);
}

/** 校验一份主机列表（严格模式：任何一条不合法都抛错），返回归一化结果。 */
export function parseBlacklistHosts(raw: unknown): string[] {
  const parsed = z.array(z.string()).safeParse(raw);
  if (!parsed.success) throw new Error(t('blacklist.notStringArray'));

  const hosts: string[] = [];
  for (const item of parsed.data) {
    const pattern = canonicalHost(item);
    if (!isValidHostPattern(pattern)) throw new Error(t('blacklist.badHost', { host: item }));
    if (!hosts.includes(pattern)) hosts.push(pattern);
  }
  if (hosts.length > MAX_BLACKLIST_HOSTS) {
    throw new Error(t('blacklist.tooMany', { max: MAX_BLACKLIST_HOSTS }));
  }
  return hosts;
}

/** 主机匹配器：精确主机命中自己，`*.` 前缀命中子域。 */
export function createHostMatcher(hosts: readonly string[]): (host: string) => boolean {
  const exact = new Set<string>();
  const suffix: string[] = [];
  for (const host of hosts) {
    const form = patternForms(canonicalHost(host));
    if (form.suffix === '') continue;
    if (form.self) exact.add(form.suffix);
    else suffix.push(form.suffix);
  }
  return (host) => {
    const value = canonicalHost(host);
    if (exact.has(value)) return true;
    // 后缀只认"子域"：host 必须比后缀多一段，example.com 不算 *.example.com 的命中
    return suffix.some((item) => value.endsWith(`.${item}`));
  };
}

/**
 * 按条目逐条增删，返回新的主机列表与本次计数。
 * 已在列表里的加不进去，不在列表里的删不掉——两种情况都只计数不报错。
 */
export function applyBlacklistChanges(
  hosts: readonly string[],
  changes: { add?: readonly string[]; remove?: readonly string[] },
): { hosts: string[]; added: number; removed: number; missing: number; skipped: number } {
  const current = new Set(hosts.map(canonicalHost));
  const add = new Set((changes.add ?? []).map(canonicalHost));
  const remove = new Set((changes.remove ?? []).map(canonicalHost));

  // 同一批里的重复与已在列表里的都并成一条：skipped 只数"本来就有"的主机
  let skipped = 0;
  let added = 0;
  for (const host of add) {
    if (current.has(host)) skipped += 1;
    else {
      current.add(host);
      added += 1;
    }
  }

  let removed = 0;
  let missing = 0;
  for (const host of remove) {
    if (current.delete(host)) removed += 1;
    else missing += 1;
  }

  return { hosts: [...current], added, removed, missing, skipped };
}
