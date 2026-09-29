import { describe, expect, it } from 'vitest';
import { offlineAction, OFFLINE_ACTIONS } from '../../electron/offline-actions.mjs';

interface FakeContext {
  calls: string[];
  context: Record<string, unknown>;
}

function fakeContext(): FakeContext {
  const calls: string[] = [];
  return {
    calls,
    context: {
      kernel: {
        stop: async () => {
          calls.push('kernel.stop');
        },
      },
      guard: {
        disable: async () => {
          calls.push('guard.disable');
          return { guarding: false };
        },
        apply: async () => {
          calls.push('guard.apply');
          return { guarding: true };
        },
      },
      writeConfig: async () => {
        calls.push('writeConfig');
      },
      restartKernel: async () => {
        calls.push('restartKernel');
        return { state: 'running' };
      },
    },
  };
}

describe('离线兜底动作', () => {
  it('完全关闭代理：先停内核再关系统代理，走 /api/offline/shutdown', async () => {
    const { calls, context } = fakeContext();
    const action = offlineAction('shutdown');

    expect(action.httpPath).toBe('/api/offline/shutdown');
    await action.run(context);
    expect(calls).toEqual(['kernel.stop', 'guard.disable']);
  });

  it('立即重启内核：写期望值 → 重写配置 → 重启内核，走 /api/offline/restart', async () => {
    const { calls, context } = fakeContext();
    const action = offlineAction('restart');

    expect(action.httpPath).toBe('/api/offline/restart');
    await action.run(context);
    expect(calls).toEqual(['guard.apply', 'writeConfig', 'restartKernel']);
  });

  it('未知动作直接报错，不静默', () => {
    expect(Object.keys(OFFLINE_ACTIONS)).toEqual(['shutdown', 'restart']);
    expect(() => offlineAction('whatever')).toThrow('未知的离线动作');
  });
});
