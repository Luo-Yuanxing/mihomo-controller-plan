import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countSubscriptionProxies } from '../../src/sub/download.js';

function writeTemp(text: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-sub-'));
  const file = path.join(dir, 'subscription.yaml');
  writeFileSync(file, text, 'utf8');
  return file;
}

describe('countSubscriptionProxies', () => {
  it('统计 proxies 条数', () => {
    const file = writeTemp(
      'proxies:\n  - {name: a, type: socks5, server: 127.0.0.1, port: 1}\n  - {name: b, type: http, server: 127.0.0.1, port: 2}\n',
    );
    expect(countSubscriptionProxies(file)).toBe(2);
  });

  it('空订阅、缺 proxies、非法 YAML、文件不存在都返回 0', () => {
    expect(countSubscriptionProxies(writeTemp('proxies: []'))).toBe(0);
    expect(countSubscriptionProxies(writeTemp('proxy-groups: []'))).toBe(0);
    expect(countSubscriptionProxies(writeTemp('proxies: ['))).toBe(0);
    expect(countSubscriptionProxies(path.join(os.tmpdir(), 'mcp-sub-missing.yaml'))).toBe(0);
  });
});
