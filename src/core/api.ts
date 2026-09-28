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
}

export function createCoreApi(_options: { controller: string; secret: string }): CoreApi {
  throw new Error('未实现：mihomo REST 客户端');
}
