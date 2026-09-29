import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { CoreStatus } from '../../src/core/manager.js';
import { createKernelProxyLink } from '../../src/core/proxy-link.js';
import type { ProxyGuard, ProxyState } from '../../src/proxy/guard.js';

function proxyState(enable: boolean): ProxyState {
  return {
    desired: { enable, server: '127.0.0.1:7890', override: 'localhost;127.*' },
    actual: null,
    match: false,
    guarding: enable,
    supported: true,
    error: null,
  };
}

function fakeGuard(calls: string[], enableThrows = false): ProxyGuard {
  return {
    state: async () => proxyState(false),
    enable: async () => {
      if (enableThrows) throw new Error('注册表写入被拒');
      calls.push('enable');
      return proxyState(true);
    },
    disable: async () => {
      calls.push('disable');
      return proxyState(false);
    },
    apply: async () => proxyState(false),
    setServer: async () => proxyState(false),
    shutdown: async () => undefined,
  };
}

function coreStatus(state: CoreStatus['state']): CoreStatus {
  return {
    state,
    pid: null,
    version: null,
    error: null,
    controller: '127.0.0.1:9090',
    mixedPort: 7890,
    binaryPath: 'resources/bin/mihomo.exe',
  };
}

function linkWith(calls: string[], enableThrows = false) {
  return createKernelProxyLink({
    guard: fakeGuard(calls, enableThrows),
    log: pino({ level: 'silent' }),
  });
}

describe('内核与系统代理联动', () => {
  it('内核就绪（running / adopted）就打开系统代理', async () => {
    for (const state of ['running', 'adopted'] as const) {
      const calls: string[] = [];
      const result = await linkWith(calls).sync(coreStatus(state), '测试');

      expect(calls, state).toEqual(['enable']);
      expect(result?.desired.enable, state).toBe(true);
    }
  });

  it('内核不在跑（stopped / failed）就关闭系统代理', async () => {
    for (const state of ['stopped', 'failed'] as const) {
      const calls: string[] = [];
      const result = await linkWith(calls).sync(coreStatus(state), '测试');

      expect(calls, state).toEqual(['disable']);
      expect(result?.desired.enable, state).toBe(false);
    }
  });

  it('联动失败只记日志，不向外抛（内核状态照常返回）', async () => {
    const calls: string[] = [];

    await expect(
      linkWith(calls, true).sync(coreStatus('running'), '测试'),
    ).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});
