/**
 * mihomo 内核 REST 客户端（HTTP 控制接口）。
 * 计划 §4.2 数据流、附录 B 内核 API 速查。
 */
/** GET /proxies 的单项：节点只有 name/type，代理组另有 all/now。 */
export interface ProxyEntry {
  name: string;
  type: string;
  now?: string;
  all?: string[];
}

export type ProxySnapshot = Record<string, ProxyEntry>;

/** 可选出口的代理组（目标策略里的"代理"最终落到这里）。 */
export interface ProxyGroupSummary {
  name: string;
  type: string;
  now: string;
  all: string[];
}

/** 内核自己生成的组，规则用不到，不列给用户选。 */
const AUTO_GROUPS = new Set(['GLOBAL', 'COMPATIBLE']);

/** 从 GET /proxies 快照里挑出代理组：带 all 列表的即为组，按名称排序。 */
export function proxyGroups(snapshot: ProxySnapshot): ProxyGroupSummary[] {
  return Object.values(snapshot)
    .filter(
      (entry) => Array.isArray(entry.all) && entry.all.length > 0 && !AUTO_GROUPS.has(entry.name),
    )
    .map((entry) => ({
      name: entry.name,
      type: entry.type,
      now: typeof entry.now === 'string' ? entry.now : '',
      all: entry.all ?? [],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export interface CoreApi {
  /** GET /version，用于就绪探测与探活。 */
  version(): Promise<{ version: string; meta: boolean }>;
  /** PUT /providers/rules/{name}，规则热更新落点。 */
  reloadRuleProvider(name: string): Promise<void>;
  /** PUT /providers/proxies/{name}，订阅更新后重新读取文件。 */
  reloadProxyProvider(name: string): Promise<void>;
  /** GET /proxies，读取代理组与节点（含当前出口 now）。 */
  proxies(): Promise<ProxySnapshot>;
  /** PUT /proxies/{name}，切换代理组的当前出口。 */
  selectProxy(name: string, choice: string): Promise<void>;
  /**
   * GET /group/{name}/delay，并发测组内每个节点的时延（毫秒）。
   * 测不通的节点不会出现在结果里；整组都不通时返回空对象。
   */
  groupDelay(name: string): Promise<Record<string, number>>;
  /** GET /configs。 */
  configs(): Promise<Record<string, unknown>>;
  /** GET /rules，用于核对当前生效规则。 */
  rules(): Promise<Record<string, unknown>>;
}

export interface CoreApiOptions {
  controller: string;
  secret: string;
  timeoutMs?: number;
}

/** 内核 REST 的错误，带状态码：504 表示组内节点全部超时，是正常结果不是故障。 */
export class CoreApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CoreApiError';
  }
}

/** 测延迟的探针地址与单节点超时，和 proxy-provider 的健康检查保持一致。 */
export const DELAY_TEST_URL = 'http://www.gstatic.com/generate_204';
export const DELAY_TEST_TIMEOUT_MS = 3000;

export function createCoreApi(options: CoreApiOptions): CoreApi {
  const base = `http://${options.controller}`;
  const timeoutMs = options.timeoutMs ?? 5000;
  const authHeaders: Record<string, string> =
    options.secret === '' ? {} : { Authorization: `Bearer ${options.secret}` };

  async function request(
    pathname: string,
    init: RequestInit = {},
    requestTimeoutMs: number = timeoutMs,
  ): Promise<Response> {
    const method = init.method ?? 'GET';
    let response: Response;
    try {
      response = await fetch(`${base}${pathname}`, {
        ...init,
        headers: { ...authHeaders, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`连不上内核 ${base}（${reason}）`);
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      throw new CoreApiError(
        `${method} ${pathname} 返回 ${response.status}${body === '' ? '' : ` ${body}`}`,
        response.status,
      );
    }
    return response;
  }

  return {
    async version() {
      const response = await request('/version');
      const payload = (await response.json()) as { version?: string; meta?: boolean };
      return { version: payload.version ?? 'unknown', meta: payload.meta === true };
    },
    async reloadRuleProvider(name: string) {
      await request(`/providers/rules/${encodeURIComponent(name)}`, { method: 'PUT' });
    },
    async reloadProxyProvider(name: string) {
      await request(`/providers/proxies/${encodeURIComponent(name)}`, { method: 'PUT' });
    },
    async proxies() {
      const response = await request('/proxies');
      const payload = (await response.json()) as { proxies?: ProxySnapshot };
      return payload.proxies ?? {};
    },
    async selectProxy(name: string, choice: string) {
      await request(`/proxies/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: choice }),
      });
    },
    async groupDelay(name: string) {
      const query = `timeout=${String(DELAY_TEST_TIMEOUT_MS)}&url=${encodeURIComponent(DELAY_TEST_URL)}`;
      try {
        const response = await request(
          `/group/${encodeURIComponent(name)}/delay?${query}`,
          {},
          DELAY_TEST_TIMEOUT_MS + 5000,
        );
        return (await response.json()) as Record<string, number>;
      } catch (error) {
        // 全部节点都超时是正常测试结果，交给界面按"超时"渲染
        if (error instanceof CoreApiError && error.status === 504) return {};
        throw error;
      }
    },
    async configs() {
      const response = await request('/configs');
      return (await response.json()) as Record<string, unknown>;
    },
    async rules() {
      const response = await request('/rules');
      return (await response.json()) as Record<string, unknown>;
    },
  };
}
