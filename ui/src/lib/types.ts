/**
 * 与后端 REST 返回结构一一对应的类型（来源：src/routes.ts）。
 * 后端改了字段，这里要同步改。
 */
/** 只保留域名类规则，与后端 src/rules/render.ts 保持一致。 */
export const RULE_TYPES = ['DOMAIN-SUFFIX', 'DOMAIN'] as const;

export type RuleType = (typeof RULE_TYPES)[number];

/** 目标策略只开放直连/代理两项，PROXY 为默认首选。 */
export const POLICY_OPTIONS = [
  { value: 'PROXY', label: '代理' },
  { value: 'DIRECT', label: '直连' },
] as const;

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
