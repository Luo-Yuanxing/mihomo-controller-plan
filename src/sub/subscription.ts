/**
 * 订阅文件（data/subscription.yaml）的唯一解析入口：节点数、proxy-groups、dns 段一次读出来。
 *
 * 为什么要复刻组：file 类型 proxy-provider 只把 `proxies` 交给内核，订阅自带的组不会进内核。
 * 所以"PROXY 指代订阅里哪个组"只能由本程序按所选组的定义重新生成，节点成员一律由
 * `use: [provider]` 提供（内核不接受在 `proxies:` 里写 provider 节点名，见 mihomo 的
 * outboundgroup.getProxies）。
 */
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { PROXY_GROUP_NAME } from '../config/template.js';

/** 组定义里原样带过的字段（其余字段对组行为无意义或与 provider 冲突）。 */
const CARRY_KEYS = [
  'url',
  'interval',
  'tolerance',
  'timeout',
  'lazy',
  'expected-status',
  'strategy',
  'disable-udp',
  'max-failed-times',
] as const;

export interface SubscriptionGroup {
  name: string;
  type: string;
  /** 组成员名：可能是节点，也可能是另一个组 */
  members: string[];
  extra: { key: string; value: unknown }[];
}

/** 生成配置里要写出的组：节点成员由 use 提供，这里只记组与组的引用关系。 */
export interface RenderedGroup {
  name: string;
  type: string;
  refs: string[];
  extra: { key: string; value: unknown }[];
}

export interface SubscriptionFile {
  /** 解析后的订阅根对象；不是映射（含文件缺失、非法 YAML）时为 null。 */
  document: Record<string, unknown> | null;
  /** proxies 数组长度；0 = 这份订阅不能当"有订阅"用，否则 PROXY 组会静默直连。 */
  proxies: number;
  groups: SubscriptionGroup[];
  dns: Record<string, unknown> | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

function pickExtra(mapping: Record<string, unknown>): { key: string; value: unknown }[] {
  return CARRY_KEYS.filter((key) => mapping[key] !== undefined).map((key) => ({
    key,
    value: mapping[key],
  }));
}

function toGroup(name: unknown, mapping: Record<string, unknown>): SubscriptionGroup | null {
  if (typeof name !== 'string' || name === '') return null;
  return {
    name,
    type:
      typeof mapping['type'] === 'string' && mapping['type'] !== '' ? mapping['type'] : 'select',
    members: asStrings(mapping['proxies']),
    extra: pickExtra(mapping),
  };
}

function readGroups(rawGroups: unknown): SubscriptionGroup[] {
  const groups: SubscriptionGroup[] = [];

  if (Array.isArray(rawGroups)) {
    for (const item of rawGroups) {
      if (!isRecord(item)) continue;
      const group = toGroup(item['name'], item);
      if (group !== null) groups.push(group);
    }
    return groups;
  }

  // 少数订阅用 name -> 定义 的映射写法
  if (isRecord(rawGroups)) {
    for (const [name, value] of Object.entries(rawGroups)) {
      if (!isRecord(value)) continue;
      const group = toGroup(name, value);
      if (group !== null) groups.push(group);
    }
  }
  return groups;
}

/** 解析订阅全文；非法 YAML 按空订阅处理（调用方只关心"能不能用"）。 */
export function parseSubscription(text: string): SubscriptionFile {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch {
    document = null;
  }
  const root = isRecord(document) ? document : null;
  const proxies = root !== null && Array.isArray(root['proxies']) ? root['proxies'].length : 0;
  const dns = root?.['dns'];
  return {
    document: root,
    proxies,
    groups: root === null ? [] : readGroups(root['proxy-groups']),
    dns: isRecord(dns) ? dns : null,
  };
}

/** 读订阅文件；文件缺失或读不到按空订阅处理。 */
export function readSubscription(file: string): SubscriptionFile {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { document: null, proxies: 0, groups: [], dns: null };
  }
  return parseSubscription(text);
}

/**
 * 把订阅里的 chosen 组复刻成生成配置里的 PROXY 组，并递归带上它引用的组。
 * 找不到该组时返回空数组，调用方回退成"PROXY 用订阅全部节点"。
 */
export function materializeProxyGroups(
  chosen: string,
  source: SubscriptionGroup[],
): RenderedGroup[] {
  const byName = new Map(source.map((group) => [group.name, group]));
  const root = byName.get(chosen);
  if (root === undefined) return [];

  const rendered: RenderedGroup[] = [];
  const done = new Set<string>();
  const queue: { group: SubscriptionGroup; name: string }[] = [
    { group: root, name: PROXY_GROUP_NAME },
  ];

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) break;
    const { group, name } = item;
    if (done.has(name)) continue;
    done.add(name);

    const refs: string[] = [];
    for (const member of group.members) {
      const nested = byName.get(member);
      // 节点成员交给 use；自引用忽略；与 PROXY 同名的组无法再生成一份，一并忽略
      if (nested === undefined || nested.name === group.name) continue;
      if (nested.name === PROXY_GROUP_NAME) continue;
      refs.push(nested.name);
      queue.push({ group: nested, name: nested.name });
    }

    rendered.push({ name, type: group.type, refs, extra: group.extra });
  }

  return rendered;
}

/** 设置页与写配置共用的入口：chosen 为空或订阅里没有该组时返回 null。 */
export function planProxyGroups(
  subscription: SubscriptionFile,
  chosen: string,
): RenderedGroup[] | null {
  if (chosen === '') return null;
  const rendered = materializeProxyGroups(chosen, subscription.groups);
  return rendered.length === 0 ? null : rendered;
}
