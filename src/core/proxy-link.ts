/**
 * 内核 ↔ 系统代理的单向联动：内核在跑就把系统代理指向它，内核不在跑就关掉系统代理。
 * 反向不成立——开关系统代理不会启动或停止内核。
 *
 * 为什么必须是这个方向：系统代理开着而内核没跑，等于把整机流量送去一个没人监听的端口
 * （表现就是"断网、但面板自己还能开"）；反过来内核就绪时顺手把代理开上，用户不必记得手动开。
 */
import type { Logger } from 'pino';
import type { ProxyGuard, ProxyState } from '../proxy/guard.js';
import type { CoreStatus } from './manager.js';

export interface KernelProxyLink {
  /** 按内核状态同步系统代理；联动失败只记日志，不影响内核自身的状态返回。 */
  sync(status: CoreStatus, reason: string): Promise<ProxyState | null>;
}

export function createKernelProxyLink(options: {
  guard: ProxyGuard;
  log: Logger;
}): KernelProxyLink {
  const { guard, log } = options;

  return {
    async sync(status: CoreStatus, reason: string) {
      const kernelUp = status.state === 'running' || status.state === 'adopted';
      try {
        if (kernelUp) {
          // 端口由 guard 的期望值决定；enable 会顺带纳入守护，内核退出时还能被拉回来
          const state = await guard.enable();
          log.info({ reason, server: state.desired.server }, '内核已就绪，系统代理已指向内核');
          return state;
        }
        const state = await guard.disable();
        log.warn(
          { reason, kernel: status.state },
          '内核不可用，已关闭系统代理以免整机流量指向无人监听的端口',
        );
        return state;
      } catch (error) {
        log.error(
          { reason, err: error instanceof Error ? error.message : String(error) },
          '内核与系统代理联动失败',
        );
        return null;
      }
    },
  };
}
