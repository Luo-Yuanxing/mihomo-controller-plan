import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSubscriptionDns } from '../../src/sub/dns.js';

function writeSubscription(text: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-dns-'));
  const file = path.join(dir, 'subscription.yaml');
  writeFileSync(file, text, 'utf8');
  return file;
}

describe('readSubscriptionDns', () => {
  it('原样取出订阅的 dns 段', () => {
    const dns = readSubscriptionDns(
      writeSubscription(`
proxies:
  - { name: 香港, type: vless }
dns:
  enable: true
  enhanced-mode: fake-ip
  default-nameserver: [223.5.5.5, 119.29.29.29]
  nameserver: ['https://dns.alidns.com/dns-query']
  fallback-filter: { geoip: true, geoip-code: CN }
`),
    );

    expect(dns?.['enhanced-mode']).toBe('fake-ip');
    expect(dns?.['default-nameserver']).toEqual(['223.5.5.5', '119.29.29.29']);
    expect(dns?.['fallback-filter']).toEqual({ geoip: true, 'geoip-code': 'CN' });
  });

  it('没有 dns 段、文件缺失、非法 YAML 都返回 null', () => {
    expect(readSubscriptionDns(writeSubscription('proxies: []\n'))).toBeNull();
    expect(readSubscriptionDns(writeSubscription('\t- 不是 yaml: ['))).toBeNull();
    expect(readSubscriptionDns(path.join(os.tmpdir(), 'mcp-没有.yaml'))).toBeNull();
  });
});
