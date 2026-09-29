import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  materializeProxyGroups,
  planProxyGroups,
  readSubscription,
} from '../../src/sub/subscription.js';

const SUBSCRIPTION = `
proxies:
  - { name: '香港', type: vless, server: hk.example.com, port: 443 }
  - { name: '日本', type: vless, server: jp.example.com, port: 443 }
  - { name: '剩余流量：39.81 GB', type: vless, server: info.example.com, port: 443 }
proxy-groups:
  - { name: Proxy, type: select, proxies: [failover, '剩余流量：39.81 GB', '香港', '日本'] }
  - { name: failover, type: fallback, proxies: ['香港', '日本'], url: 'http://www.gstatic.com/generate_204', interval: 300 }
dns:
  enable: true
  enhanced-mode: fake-ip
  default-nameserver: [223.5.5.5, 119.29.29.29]
  fallback-filter: { geoip: true, geoip-code: CN }
`;

function writeSubscription(text: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-sub-'));
  const file = path.join(dir, 'subscription.yaml');
  writeFileSync(file, text, 'utf8');
  return file;
}

describe('readSubscription', () => {
  it('一次读出节点数、组定义与 dns 段', () => {
    const subscription = readSubscription(writeSubscription(SUBSCRIPTION));

    expect(subscription.proxies).toBe(3);
    expect(subscription.groups.map((group) => group.name)).toEqual(['Proxy', 'failover']);
    expect(subscription.groups[0]?.members).toEqual([
      'failover',
      '剩余流量：39.81 GB',
      '香港',
      '日本',
    ]);
    expect(subscription.groups[1]?.extra).toEqual([
      { key: 'url', value: 'http://www.gstatic.com/generate_204' },
      { key: 'interval', value: 300 },
    ]);
    expect(subscription.dns?.['enhanced-mode']).toBe('fake-ip');
  });

  it('映射写法的 proxy-groups 也认', () => {
    const file = writeSubscription(
      'proxies: [{ name: a, type: vless }]\nproxy-groups:\n  Proxy: { type: select, proxies: [a] }\n',
    );
    expect(readSubscription(file).groups.map((group) => group.name)).toEqual(['Proxy']);
  });

  it('空订阅、缺 proxies、非法 YAML、文件缺失都按空订阅处理', () => {
    expect(readSubscription(writeSubscription('proxies: []')).proxies).toBe(0);
    expect(readSubscription(writeSubscription('proxy-groups: []')).proxies).toBe(0);
    expect(readSubscription(writeSubscription('proxies: [')).document).toBeNull();
    expect(readSubscription(writeSubscription('\t- 不是 yaml: [')).document).toBeNull();
    expect(readSubscription(path.join(os.tmpdir(), 'mcp-没有.yaml')).document).toBeNull();
    expect(readSubscription(writeSubscription('proxies: []\n')).dns).toBeNull();
  });
});

describe('materializeProxyGroups', () => {
  it('把所选组复刻成 PROXY，并递归带上它引用的组', () => {
    const groups = readSubscription(writeSubscription(SUBSCRIPTION)).groups;

    expect(materializeProxyGroups('Proxy', groups)).toEqual([
      { name: 'PROXY', type: 'select', refs: ['failover'], extra: [] },
      {
        name: 'failover',
        type: 'fallback',
        refs: [],
        extra: [
          { key: 'url', value: 'http://www.gstatic.com/generate_204' },
          { key: 'interval', value: 300 },
        ],
      },
    ]);
  });

  it('订阅里没有这个组时返回空，交给调用方回退', () => {
    const groups = readSubscription(writeSubscription(SUBSCRIPTION)).groups;
    expect(materializeProxyGroups('不存在', groups)).toEqual([]);
  });
});

describe('planProxyGroups', () => {
  it('未选组返回 null，选了但订阅里没有也返回 null', () => {
    const subscription = readSubscription(writeSubscription(SUBSCRIPTION));
    expect(planProxyGroups(subscription, '')).toBeNull();
    expect(planProxyGroups(subscription, '不存在')).toBeNull();
    expect(
      planProxyGroups(readSubscription(path.join(os.tmpdir(), 'mcp-没有.yaml')), 'Proxy'),
    ).toBeNull();
  });

  it('选中的组返回复刻结果', () => {
    const subscription = readSubscription(writeSubscription(SUBSCRIPTION));
    const plan = planProxyGroups(subscription, 'failover');
    expect(plan?.map((group) => group.name)).toEqual(['PROXY']);
    expect(plan?.[0]?.type).toBe('fallback');
  });
});
