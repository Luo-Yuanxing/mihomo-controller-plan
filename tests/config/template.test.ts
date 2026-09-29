import { describe, expect, it } from 'vitest';
import { renderConfig } from '../../src/config/template.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';

const base = {
  settings: DEFAULT_SETTINGS,
  secret: 'test-secret',
  ruleProvider: 'custom',
};

describe('renderConfig', () => {
  it('有订阅文件时引用 proxy-provider', () => {
    const yaml = renderConfig({
      ...base,
      subscriptionProvider: 'sub-main',
    });

    expect(yaml).toContain('proxy-providers:');
    expect(yaml).toContain('path: ./subscription.yaml');
    expect(yaml).toContain('    use:\n      - sub-main');
    // 用户选的出口要能跨重启保留，否则每次都回到组内第一个节点
    expect(yaml).toContain('profile:\n  store-selected: true');
  });

  it('无订阅文件时用 REJECT-DROP 占位，命中 PROXY 的流量丢弃超时', () => {
    const yaml = renderConfig({
      ...base,
      subscriptionProvider: null,
    });

    expect(yaml).not.toContain('proxy-providers:');
    expect(yaml).not.toContain('./subscription.yaml');
    expect(yaml).toContain('    proxies:\n      - REJECT-DROP');
    expect(yaml).not.toContain('      - DIRECT');
    expect(yaml).toContain('MATCH,PROXY');
  });

  it('选了 PROXY 指代的组时按该组复刻，节点仍由 provider 提供', () => {
    const yaml = renderConfig({
      ...base,
      subscriptionProvider: 'sub-main',
      proxyGroupPlan: [
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
      ],
    });

    expect(yaml).toContain('  - name: PROXY\n    type: select\n    use:\n      - sub-main');
    expect(yaml).toContain('    proxies:\n      - failover');
    expect(yaml).toContain('  - name: failover\n    type: fallback\n    use:\n      - sub-main');
    expect(yaml).toContain('    url: http://www.gstatic.com/generate_204');
    expect(yaml).toContain('    interval: 300');
    expect(yaml).toContain('MATCH,PROXY');
  });

  it('组名带特殊字符时加引号，避免 YAML 解析歧义', () => {
    const yaml = renderConfig({
      ...base,
      subscriptionProvider: 'sub-main',
      proxyGroupPlan: [{ name: 'PROXY', type: 'select', refs: ['自动 选择'], extra: [] }],
    });

    expect(yaml).toContain('    proxies:\n      - "自动 选择"');
  });
});
