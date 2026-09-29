import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  materializeProxyGroups,
  planProxyGroups,
  readSubscriptionGroups,
} from '../../src/sub/groups.js';

const SUBSCRIPTION = `
proxies:
  - { name: '香港', type: vless, server: hk.example.com, port: 443 }
  - { name: '日本', type: vless, server: jp.example.com, port: 443 }
  - { name: '剩余流量：39.81 GB', type: vless, server: info.example.com, port: 443 }
proxy-groups:
  - { name: Proxy, type: select, proxies: [failover, '剩余流量：39.81 GB', '香港', '日本'] }
  - { name: failover, type: fallback, proxies: ['香港', '日本'], url: 'http://www.gstatic.com/generate_204', interval: 300 }
`;

function writeSubscription(text: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-sub-'));
  const file = path.join(dir, 'subscription.yaml');
  writeFileSync(file, text, 'utf8');
  return file;
}

describe('readSubscriptionGroups', () => {
  it('读出组名、类型、成员与 url/interval', () => {
    const source = readSubscriptionGroups(writeSubscription(SUBSCRIPTION));

    expect(source.groups.map((group) => group.name)).toEqual(['Proxy', 'failover']);
    expect(source.groups[0]?.members).toEqual(['failover', '剩余流量：39.81 GB', '香港', '日本']);
    expect(source.groups[1]?.extra).toEqual([
      { key: 'url', value: 'http://www.gstatic.com/generate_204' },
      { key: 'interval', value: 300 },
    ]);
  });

  it('文件缺失或不是 YAML 时按没有组处理', () => {
    expect(readSubscriptionGroups(path.join(os.tmpdir(), 'mcp-不存在.yaml')).groups).toEqual([]);
    expect(readSubscriptionGroups(writeSubscription('\t- 不是 yaml: [')).groups).toEqual([]);
  });
});

describe('materializeProxyGroups', () => {
  it('把所选组复刻成 PROXY，并递归带上它引用的组', () => {
    const source = readSubscriptionGroups(writeSubscription(SUBSCRIPTION));

    expect(materializeProxyGroups('Proxy', source)).toEqual([
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
    const source = readSubscriptionGroups(writeSubscription(SUBSCRIPTION));
    expect(materializeProxyGroups('不存在', source)).toEqual([]);
  });
});

describe('planProxyGroups', () => {
  it('未选组返回 null，选了但订阅里没有也返回 null', () => {
    const file = writeSubscription(SUBSCRIPTION);
    expect(planProxyGroups({ file, chosen: '' })).toBeNull();
    expect(planProxyGroups({ file, chosen: '不存在' })).toBeNull();
    expect(
      planProxyGroups({ file: path.join(os.tmpdir(), 'mcp-没有.yaml'), chosen: 'Proxy' }),
    ).toBeNull();
  });

  it('选中的组返回复刻结果', () => {
    const plan = planProxyGroups({ file: writeSubscription(SUBSCRIPTION), chosen: 'failover' });
    expect(plan?.map((group) => group.name)).toEqual(['PROXY']);
    expect(plan?.[0]?.type).toBe('fallback');
  });
});
