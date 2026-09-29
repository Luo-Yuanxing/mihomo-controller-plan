/**
 * 与后端 REST 返回结构一一对应的类型（来源：src/routes.ts）。
 * 后端改了字段，这里要同步改。
 */
/**
 * 界面可改的简单常量，来源配置文件（默认 app 目录下 config.json，GET /api/ui-config）。
 * 下面的默认值只在后端不可用时兜底，改选项请改 JSON 再点"重载常量"。
 */
export interface UiConfig {
  ruleTypes: string[];
  policies: { value: string; label: string }[];
  defaults: { ruleType: string; policy: string };
  failedConnections: { refetchIntervalMs: number; lines: number };
  settings: { logsRefetchIntervalMs: number };
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  ruleTypes: ['DOMAIN-SUFFIX', 'DOMAIN'],
  policies: [
    { value: 'PROXY', label: '代理' },
    { value: 'DIRECT', label: '直连' },
  ],
  defaults: { ruleType: 'DOMAIN-SUFFIX', policy: 'PROXY' },
  failedConnections: { refetchIntervalMs: 5000, lines: 5000 },
  settings: { logsRefetchIntervalMs: 5000 },
};

/** 系统值快照（GET /api/ui-config）。 */
export interface UiConfigState {
  file: string;
  config: UiConfig;
  updatedAt: string | null;
}

/** 预览对比的逐项差异。 */
export interface UiConfigDiffItem {
  label: string;
  current: string;
  incoming: string;
  same: boolean;
}

export interface UiConfigPreview {
  file: string;
  config: UiConfig;
  /** 后端逐项取值检测结果（为空表示合法）。 */
  issues?: { path: string; message: string }[];
  diff: UiConfigDiffItem[];
  same: boolean;
}

export interface Rule {
  id: number;
  position: number;
  enabled: boolean;
  type: string;
  value: string;
  policy: string;
  noResolve: boolean;
}

export interface RuleInput {
  enabled: boolean;
  type: string;
  value: string;
  policy: string;
  noResolve: boolean;
}

export type CoreState = 'stopped' | 'running' | 'adopted' | 'failed';

export interface CoreStatus {
  state: CoreState;
  pid: number | null;
  version: string | null;
  error: string | null;
  controller: string;
  mixedPort: number;
  binaryPath: string;
}

export interface ProxyValues {
  enable: boolean;
  server: string;
  override: string;
}

export interface ProxyState {
  desired: ProxyValues;
  actual: ProxyValues | null;
  match: boolean;
  guarding: boolean;
  supported: boolean;
  error: string | null;
}

/** 目标策略里的"代理"最终落到的组；now 是当前出口，all 是可选节点。 */
export interface ProxyGroupSummary {
  name: string;
  type: string;
  now: string;
  all: string[];
}

export interface SubscriptionConfig {
  url: string;
  interval: number;
  useProxy: boolean;
  userAgent: string;
}

export interface SubscriptionState extends SubscriptionConfig {
  lastOkAt: string | null;
  lastError: string | null;
  bytes: number | null;
  refreshing: boolean;
}

export interface Settings {
  subscription: SubscriptionConfig;
  core: {
    binaryPath: string;
    mixedPort: number;
    controllerPort: number;
    secret: string;
  };
  proxy: {
    enabled: boolean;
    server: string;
    override: string;
  };
}

export interface StatusResponse {
  app: {
    version: string;
    dataDir: string;
    dataFallback: boolean;
    ruleProvider: string;
    subscriptionProvider: string;
  };
  kernel: CoreStatus;
  subscription: SubscriptionState & { fileExists: boolean };
  proxy: ProxyState;
}

export interface SyncResult {
  changed: boolean;
  elapsedMs: number;
  provider: string;
}

export interface FailedConnection {
  id: string;
  network: string;
  host: string;
  port: number;
  count: number;
  lastSeen: string;
  error: string;
}

export interface LogsResponse {
  app: string[];
  core: string[];
}
