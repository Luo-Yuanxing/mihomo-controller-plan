/**
 * 离线兜底动作表：Electron 壳只负责把点击转交给后端，
 * 写注册表、停/起内核这些系统级副作用全部在后端里做。
 */

export const OFFLINE_ACTIONS = {
  /** 完全关闭代理：停内核 + 关系统代理。 */
  shutdown: {
    httpPath: '/api/offline/shutdown',
    run: async (context) => {
      await context.kernel.stop();
      return { proxy: await context.guard.disable() };
    },
  },
  /** 立即重启内核：重写配置 → 重启内核（重启成功后按联动把系统代理指向内核）。 */
  restart: {
    httpPath: '/api/offline/restart',
    run: async (context) => {
      await context.writeConfig();
      return { kernel: await context.restartKernel(), proxy: await context.guard.state() };
    },
  },
};

/** 找不到的动作直接报错，别静默什么都不做。 */
export function offlineAction(name) {
  const action = OFFLINE_ACTIONS[name];
  if (action === undefined) throw new Error(`未知的离线动作：${String(name)}`);
  return action;
}
