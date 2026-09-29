/** 后端 REST 客户端；Electron 内置服务与 Vite dev 代理都是同源，无需带完整地址。 */
import type {
  CoreStatus,
  FailedConnection,
  LogsResponse,
  ProxyGroupSummary,
  ProxyState,
  Rule,
  RuleInput,
  Settings,
  StatusResponse,
  SubscriptionConfig,
  SubscriptionGroupsResponse,
  SubscriptionState,
  SyncResult,
  UiConfig,
  UiConfigPreview,
  UiConfigState,
} from './types';
import { setOffline } from './offline';

const token = (window as unknown as { mcpApiToken?: string }).mcpApiToken ?? '';

/** 后端 400 时带上逐项取值检测明细，界面按字段展示。 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        // 无 body 的请求不要带 content-type，否则 Fastify 会按空 JSON body 拒绝
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === '' ? {} : { 'x-api-token': token }),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    // 后端整个不响应也算离线，交给每秒问候决定何时恢复
    setOffline(true);
    throw error;
  }
  const text = await response.text();
  const payload: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    // 服务端 5xx 说明后端坏了：立刻进离线状态，跳状态页并给出兜底按钮
    if (response.status >= 500) setOffline(true);
    const message = (payload as { error?: string } | null)?.error;
    const issues = (payload as { issues?: { path: string; message: string }[] } | null)?.issues;
    throw new ApiError(message ?? `请求失败：HTTP ${response.status}`, issues ?? []);
  }
  return payload as T;
}

const post = <T>(path: string, body: unknown = {}): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  status: () => request<StatusResponse>('/api/status'),
  /** 离线探测：最轻的问候请求，通了就说明后端活了。 */
  ping: () => request<{ ok: boolean }>('/api/ping'),
  /** 离线兜底：关系统代理 + 停内核。 */
  offlineShutdown: () => post<{ proxy: ProxyState; kernel: CoreStatus }>('/api/offline/shutdown'),
  /** 离线兜底：无条件写系统代理期望值 + 重启内核。 */
  offlineRestart: () => post<{ proxy: ProxyState; kernel: CoreStatus }>('/api/offline/restart'),
  logs: (lines = 200) => request<LogsResponse>(`/api/logs?lines=${String(lines)}`),
  failedConnections: (lines = 5000) =>
    request<{ file: string; scannedLines: number; connections: FailedConnection[] }>(
      `/api/failed-connections?lines=${String(lines)}`,
    ),

  rules: () => request<{ rules: Rule[]; provider: string }>('/api/rules'),
  ruleProvider: () =>
    request<{ file: string; exists: boolean; yaml: string }>('/api/rules/provider'),
  createRules: (rules: RuleInput[]) => post<{ created: Rule[] }>('/api/rules', { rules }),
  updateRule: (id: number, patch: Partial<RuleInput>) =>
    request<{ rule: Rule }>(`/api/rules/${String(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteRule: (id: number) =>
    request<{ rules: Rule[] }>(`/api/rules/${String(id)}`, { method: 'DELETE' }),
  reorderRules: (ids: number[]) =>
    request<{ rules: Rule[] }>('/api/rules/order', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  syncRules: () => post<SyncResult>('/api/rules/sync'),

  settings: () => request<Settings>('/api/settings'),

  uiConfig: () => request<UiConfigState>('/api/ui-config'),
  forceLoadUiConfig: (file?: string) =>
    post<UiConfigState>('/api/ui-config/load-force', file === undefined ? {} : { file }),
  previewUiConfig: (file?: string) =>
    post<UiConfigPreview>('/api/ui-config/preview', file === undefined ? {} : { file }),
  applyUiConfig: (input: { file?: string; config: UiConfig }) =>
    post<UiConfigState>('/api/ui-config/apply', input),
  exportUiConfig: (file?: string) =>
    post<{ file: string; rules: number; bytes: number }>(
      '/api/ui-config/export',
      file === undefined ? {} : { file },
    ),

  saveSettings: (settings: Settings) =>
    request<{ settings: Settings; needsRestart: boolean; groupsRebuilt: boolean }>(
      '/api/settings',
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      },
    ),

  subscription: () =>
    request<{
      config: SubscriptionConfig;
      state: SubscriptionState;
      file: string;
      fileExists: boolean;
    }>('/api/subscription'),
  saveSubscription: (patch: Partial<SubscriptionConfig>) =>
    request<{ config: SubscriptionConfig }>('/api/subscription', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteSubscription: () =>
    request<{ deleted: boolean; config: SubscriptionConfig; kernel: CoreStatus }>(
      '/api/subscription',
      { method: 'DELETE' },
    ),
  refreshSubscription: () => post<SubscriptionState>('/api/subscription/refresh'),
  subscriptionGroups: () => request<SubscriptionGroupsResponse>('/api/subscription/groups'),

  proxy: () => request<ProxyState>('/api/proxy'),
  proxyGroups: () => request<{ target: string; groups: ProxyGroupSummary[] }>('/api/proxies'),
  selectProxy: (group: string, name: string) =>
    request<{ group: string; now: string; all: string[] }>(
      `/api/proxies/${encodeURIComponent(group)}`,
      { method: 'PUT', body: JSON.stringify({ name }) },
    ),
  groupDelay: (group: string) =>
    request<{ group: string; url: string; delays: Record<string, number> }>(
      `/api/proxies/${encodeURIComponent(group)}/delay`,
    ),
  enableProxy: () => post<ProxyState>('/api/proxy/enable'),
  disableProxy: () => post<ProxyState>('/api/proxy/disable'),
  applyProxy: () => post<ProxyState>('/api/proxy/apply'),

  restartKernel: () => post<CoreStatus>('/api/kernel/restart'),
  startKernel: () => post<CoreStatus>('/api/kernel/start'),
  stopKernel: () => post<CoreStatus>('/api/kernel/stop'),
};
