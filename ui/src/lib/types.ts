/**
 * 与后端 REST 返回结构一一对应的类型（来源：src/routes.ts）。
 * 后端改了字段，这里要同步改。
 */
/**
 * 界面可改的简单常量，来源配置文件（默认 app 目录下 config.json，GET /api/ui-config）。
 * 下面的默认值只在后端不可用时兜底，改选项请改 JSON 再点"重载常量"。
 */
export interface UiConfig {
  /** 界面语言：只有中文与英语，默认中文。 */
  language: 'zh' | 'en';
  ruleTypes: string[];
  policies: { value: string; label: string }[];
  defaults: { ruleType: string; policy: string };
  failedConnections: { refetchIntervalMs: number; lines: number };
  settings: { logsRefetchIntervalMs: number; logsLines: number };
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  language: 'zh',
  ruleTypes: ['DOMAIN', 'DOMAIN-SUFFIX'],
  policies: [
    { value: 'PROXY', label: '代理' },
    { value: 'DIRECT', label: '直连' },
  ],
  defaults: { ruleType: 'DOMAIN', policy: 'PROXY' },
  failedConnections: { refetchIntervalMs: 60000, lines: 5000 },
  settings: { logsRefetchIntervalMs: 5000, logsLines: 500 },
};

/** 生效值快照（GET /api/ui-config）：当前值 + 初始化标记（加载时即为 false）+ 文件修改时间。 */
export interface UiConfigState {
  config: UiConfig;
  /** false = 已初始化，启动就按文件生效，界面不加载引导。 */
  initialized: boolean;
  updatedAt: string | null;
}

/** 字符串导入的结果。 */
export interface UiConfigImportResult extends UiConfigState {
  rules: { count: number; changed: boolean } | null;
  warnings: string[];
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
  useProxy: boolean;
  userAgent: string;
  /** PROXY 策略指代订阅里的哪个组；空串 = 订阅全部节点。 */
  proxyGroup: string;
}

/** 订阅文件里的代理组（GET /api/subscription/groups）。 */
export interface SubscriptionGroupsResponse {
  file: string;
  exists: boolean;
  selected: string;
  groups: { name: string; type: string; members: number }[];
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
    secret: string;
  };
  proxy: {
    enabled: boolean;
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
  /** 首次失败时刻：列表按它升序，新目标只往末尾追加。 */
  firstSeen: string;
  lastSeen: string;
  error: string;
}

export interface LogsResponse {
  app: string[];
  core: string[];
}
