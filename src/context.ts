/**
 * 运行期上下文：REST 层与各模块之间的唯一装配点。
 */
import type { Logger } from 'pino';
import type { CoreApi } from './core/api.js';
import type { CoreManager, CoreStatus } from './core/manager.js';
import type { ProxyGuard } from './proxy/guard.js';
import type { RuleRepo } from './rules/repo.js';
import type { Settings } from './settings.js';
import type { dataPaths } from './util/paths.js';

export interface SubscriptionState {
  url: string;
  interval: number;
  useProxy: boolean;
  userAgent: string;
  lastOkAt: string | null;
  lastError: string | null;
  bytes: number | null;
  refreshing: boolean;
}

export interface AppContext {
  appVersion: string;
  appDir: string;
  uiDir: string;
  dataDir: string;
  dataFallback: boolean;
  paths: ReturnType<typeof dataPaths>;
  log: Logger;
  settings: Settings;
  repo: RuleRepo;
  api: CoreApi;
  kernel: CoreManager;
  guard: ProxyGuard;
  subscription: SubscriptionState;
  subscriptionProvider: string;
  ruleProvider: string;
  /** 写入 settings.json 并刷新内存中的设置。 */
  saveSettings(next: Settings): Promise<Settings>;
  /** 重新渲染 config.yaml；端口/secret 变化后需要重启内核才生效。 */
  writeConfig(): Promise<void>;
  refreshSubscription(): Promise<SubscriptionState>;
  /** 根据当前 URL 启停自动刷新定时器。 */
  syncSubscriptionTimer(): void;
  restartKernel(): Promise<CoreStatus>;
}
