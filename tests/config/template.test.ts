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
});
