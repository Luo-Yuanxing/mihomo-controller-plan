/**
 * 运行期上下文：REST 层与各模块之间的唯一装配点。
 */
import type { Logger } from 'pino';
import type { CoreApi } from './core/api.js';
import type { CoreManager, CoreStatus } from './core/manager.js';
import type { ProxyGuard } from './proxy/guard.js';
import type { RuleRepo } from './rules/repo.js';
import type { Settings } from './settings.js';
import type { UiConfig } from './ui-config.js';
import type { StoredUiConfig, UiConfigDiffItem } from './ui-config-store.js';
import type { dataPaths } from './util/paths.js';

export interface SubscriptionState {
  url: string;
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
  /** 当前生效的界面常量（data/ui-config.json）。 */
  uiConfig: UiConfig;
  /** 系统值快照：配置文件路径 + 生效值 + 落库时间。 */
  uiConfigState(): StoredUiConfig;
  /** 强制按配置文件加载：读文件直接覆盖系统值并落库。 */
  forceLoadUiConfig(file?: string): Promise<StoredUiConfig>;
  /** 预览方式加载：只读文件并与系统值逐项对比，不改任何状态。 */
  previewUiConfig(file?: string): Promise<{
    file: string;
    config: UiConfig;
    diff: UiConfigDiffItem[];
  }>;
  /** 把界面上的值保存进系统（持久化并立即生效）。 */
  applyUiConfig(input: { file?: string; config: unknown }): Promise<StoredUiConfig>;
  /** 写入 settings.json 并刷新内存中的设置。 */
  saveSettings(next: Settings): Promise<Settings>;
  /** 重新渲染 config.yaml；端口/secret 变化后需要重启内核才生效。 */
  writeConfig(): Promise<void>;
  refreshSubscription(): Promise<SubscriptionState>;
  restartKernel(): Promise<CoreStatus>;
}
