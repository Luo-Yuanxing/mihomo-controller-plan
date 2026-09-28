/**
 * mihomo 内核 REST 客户端（HTTP 控制接口）。
 * 计划 §4.2 数据流、附录 B 内核 API 速查。
 */
export interface CoreApi {
  /** GET /version，用于就绪探测与探活。 */
  version(): Promise<{ version: string; meta: boolean }>;
  /** PUT /providers/rules/{name}，规则热更新落点。 */
  reloadRuleProvider(name: string): Promise<void>;
  /** PUT /providers/proxies/{name}，订阅更新后重新读取文件。 */
  reloadProxyProvider(name: string): Promise<void>;
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

export function createCoreApi(options: CoreApiOptions): CoreApi {
  const base = `http://${options.controller}`;
  const timeoutMs = options.timeoutMs ?? 5000;
  const authHeaders: Record<string, string> =
    options.secret === '' ? {} : { Authorization: `Bearer ${options.secret}` };

  async function request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? 'GET';
    let response: Response;
    try {
      response = await fetch(`${base}${pathname}`, {
        ...init,
        headers: { ...authHeaders, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`连不上内核 ${base}（${reason}）`);
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      throw new Error(
        `${method} ${pathname} 返回 ${response.status}${body === '' ? '' : ` ${body}`}`,
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
