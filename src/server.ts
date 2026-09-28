/**
 * 入口：REST + 静态资源 + 启动流程。
 * 计划 §4.3 目录结构、§6 接口清单。
 */
import Fastify, { type FastifyInstance } from 'fastify';

export interface ServerOptions {
  dataDir: string;
  apiToken: string;
}

export function buildServer(_options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  // TODO: 注册 /api/status、/api/subscription、/api/rules、/api/proxy、/api/logs
  // TODO: 注册 ui/dist 静态资源
  // TODO: 启动流程：定位数据目录 → 订阅 → 内核 → ProxyGuard（失败即停）

  return app;
}

if (process.env['MCP_STANDALONE'] === '1') {
  const app = buildServer({
    dataDir: process.env['MCP_DATA_DIR'] ?? 'data',
    apiToken: process.env['MCP_API_TOKEN'] ?? '',
  });
  await app.listen({ host: '127.0.0.1', port: Number(process.env['MCP_PORT'] ?? 8787) });
}
