/**
 * 运行期上下文：REST 层与各模块之间的唯一装配点。
 */
import type { Logger } from 'pino';
import type { CoreApi } from './core/api.js';
import type { CoreManager, CoreStatus } from './core/manager.js';
import type { ConnectionTracker } from './logs/connection-sampler.js';
import type { ProxyGuard } from './proxy/guard.js';
import type { RuleRepo } from './rules/repo.js';
import type { Settings } from './settings.js';
import type { UiConfig } from './ui-config.js';
import type { StoredUiConfig, UiConfigImportResult } from './ui-config-store.js';
import type { SharedConfig } from './ui-config-share.js';
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
  dataDir: string;
  dataFallback: boolean;
  paths: ReturnType<typeof dataPaths>;
  log: Logger;
  settings: Settings;
  repo: RuleRepo;
  api: CoreApi;
  /** 连接生命周期采样：补上内核日志里没有的"连上了但零回程"。 */
  failureTracker: ConnectionTracker;
  kernel: CoreManager;
  guard: ProxyGuard;
  subscription: SubscriptionState;
  subscriptionProvider: string;
  ruleProvider: string;
  /** 当前生效的界面常量（config.json 的界面常量段）。 */
  uiConfig: UiConfig;
  /** 生效值快照：当前值 + 初始化标记（加载时即为 false）+ 文件修改时间。 */
  uiConfigState(): StoredUiConfig;
  /** 保存界面常量到 config.json（存过一次就算配置好了）。 */
  applyUiConfig(config: unknown): Promise<StoredUiConfig>;
  /** 立即初始化：把 config.json 的初始化标记改成 false，内容不动。 */
  initializeUiConfig(): Promise<StoredUiConfig>;
  /** 生成配置分享串（界面常量 + 规则 + 内核/代理设置，剔除订阅与 secret）。 */
  renderUiConfigShare(): string;
  /** 只解析分享串、不动任何状态；不合法直接抛带明细的错。 */
  decodeUiConfigShare(payload: string): SharedConfig;
  /** 解析并导入配置分享串：界面常量与规则段落盘，应用设置段交给调用方。 */
  importUiConfigShare(payload: string): Promise<UiConfigImportResult>;
  /** 写回统一配置文件并刷新内存中的设置。 */
  saveSettings(next: Settings): Promise<Settings>;
  /** 重新渲染 config.yaml；端口/secret 变化后需要重启内核才生效。 */
  writeConfig(): Promise<void>;
  refreshSubscription(): Promise<SubscriptionState>;
  /** 启动内核，并按其结果联动系统代理（起来就开、没起来就关）。 */
  startKernel(): Promise<CoreStatus>;
  /** 停止内核，并关闭系统代理（内核没了端口就没人接听）。 */
  stopKernel(): Promise<CoreStatus>;
  /** 重启内核，并按结果联动系统代理。 */
  restartKernel(): Promise<CoreStatus>;
}
