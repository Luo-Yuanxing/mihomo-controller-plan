import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import { createProxyGuard, ensureLocalBypass } from '../../src/proxy/guard.js';

const log = { warn() {}, error() {}, info() {} } as unknown as Logger;

describe('ensureLocalBypass', () => {
  it('空值只留必需项', () => {
    expect(ensureLocalBypass('')).toBe('localhost;127.*');
  });

  it('已有的必需项不重复补', () => {
    expect(ensureLocalBypass('localhost;127.*;10.*')).toBe('localhost;127.*;10.*');
  });

  it('缺项补在末尾', () => {
    expect(ensureLocalBypass('10.*;192.168.*')).toBe('10.*;192.168.*;localhost;127.*');
  });

  it('大小写不同也算已有', () => {
    expect(ensureLocalBypass('LOCALHOST;127.*')).toBe('LOCALHOST;127.*');
  });

  it('去掉空白项并清理空格', () => {
    expect(ensureLocalBypass(' 10.* ; ;localhost ')).toBe('10.*;localhost;127.*');
  });
});

describe('ProxyGuard 期望值', () => {
  it('构造时即补全本机绕过项', async () => {
    const guard = createProxyGuard({
      desired: { enable: false, server: '127.0.0.1:7890', override: '192.168.*' },
      log,
      onDesiredChange: async () => {},
    });
    const state = await guard.state();
    expect(state.desired.override).toBe('192.168.*;localhost;127.*');
  });
});
