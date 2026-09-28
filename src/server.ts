/**
 * 入口：REST + 静态资源 + 启动流程。
 * 计划 §4.3 目录结构、§6 接口清单。
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { renderConfig } from './config/template.js';
import type { AppContext, SubscriptionState } from './context.js';
import { createCoreApi } from './core/api.js';
import { ensureGeodata } from './core/geodata.js';
import { createCoreManager, type CoreStatus } from './core/manager.js';
import { createProxyGuard } from './proxy/guard.js';
import { registerRoutes } from './routes.js';
import { openRulesDatabase } from './rules/db.js';
import { RuleValidationError } from './rules/render.js';
import { createRuleRepo } from './rules/repo.js';
import { loadSettings, saveSettings as persistSettings, type Settings } from './settings.js';
import { downloadSubscription } from './sub/download.js';
import { writeFileAtomic } from './util/atomic.js';
import { acquireLock } from './util/lock.js';
import { createLogger, logPaths } from './util/logger.js';
import { dataPaths, resolveDataDir, resolveResourcePath } from './util/paths.js';

export interface ServerOptions {
  /** 应用根目录：开发期是仓库根，打包后是 app.asar 根。 */
  appDir: string;
  /** api token 为空则只依赖 127.0.0.1 回环限制。 */
  apiToken?: string;
  host?: string;
  port?: number;
  uiDir?: string;
}

export interface RunningServer {
  url: string;
  app: FastifyInstance;
  context: AppContext;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 静态资源 + SPA 回退：打包后窗口直接加载 http://127.0.0.1:port/。 */
function registerStatic(app: FastifyInstance, uiDir: string): void {
  const indexPath = path.join(uiDir, 'index.html');
  app.get('/*', async (request, reply) => {
    const relative = (request.params as Record<string, string>)['*'] ?? '';
    const requested = path.resolve(uiDir, relative === '' ? 'index.html' : relative);
    if (!requested.startsWith(path.resolve(uiDir))) {
      return reply.status(403).send({ error: '越界路径' });
    }
    const target =
      fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : indexPath;
    if (!fs.existsSync(target)) {
      return reply.status(404).send({ error: '未找到前端产物，请先执行 npm run build' });
    }
    reply.type(MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(fs.createReadStream(target));
  });
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const appDir = path.resolve(options.appDir);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(process.env['MCP_PORT'] ?? 8787);
  const uiDir = options.uiDir ?? path.join(appDir, 'ui', 'dist');

  const { dataDir, fallback } = resolveDataDir(appDir);
  const paths = dataPaths(dataDir);
  const log = createLogger(dataDir);
  ensureGeodata(dataDir, appDir, log);

  let settings: Settings = loadSettings(dataDir);
  if (settings.core.secret === '') {
    settings = { ...settings, core: { ...settings.core, secret: randomBytes(16).toString('hex') } };
    await persistSettings(dataDir, settings);
  }

  // 单实例：拿不到锁直接抛错（fail-stop，计划 §4.4）
  const lock = acquireLock(paths.appLock);
  const db = openRulesDatabase(dataDir);
  const repo = createRuleRepo(db);

  const subscriptionProvider = 'sub-main';
  const ruleProvider = 'custom';

  const subscription: SubscriptionState = {
    url: settings.subscription.url,
    interval: settings.subscription.interval,
    useProxy: settings.subscription.useProxy,
    userAgent: settings.subscription.userAgent,
    lastOkAt: null,
    lastError: null,
    bytes: null,
    refreshing: false,
  };
  let subscriptionTimer: NodeJS.Timeout | null = null;

  const syncSubscriptionTimer = (): void => {
    if (subscriptionTimer !== null) {
      clearInterval(subscriptionTimer);
      subscriptionTimer = null;
    }
    if (settings.subscription.url === '') return;

    subscriptionTimer = setInterval(() => {
      void context.refreshSubscription().catch(() => undefined);
    }, settings.subscription.interval * 1000);
    subscriptionTimer.unref?.();
  };

  const writeConfig = async (): Promise<void> => {
    const yaml = renderConfig({
      settings,
      secret: settings.core.secret,
      subscriptionProvider: fs.existsSync(paths.subscription) ? subscriptionProvider : null,
      ruleProvider,
    });
    await writeFileAtomic(paths.config, yaml);
  };

  const api = createCoreApi({
    controller: `127.0.0.1:${settings.core.controllerPort}`,
    secret: settings.core.secret,
  });

  const core = createCoreManager({
    dataDir,
    binaryPath: resolveResourcePath(appDir, settings.core.binaryPath),
    configFile: paths.config,
    mixedPort: settings.core.mixedPort,
    controllerPort: settings.core.controllerPort,
    secret: settings.core.secret,
    coreLogFile: logPaths(dataDir).core,
    log,
  });

  const guard = createProxyGuard({
    desired: {
      enable: settings.proxy.enabled,
      server: settings.proxy.server,
      override: settings.proxy.override,
    },
    log,
    onDesiredChange: async (values) => {
      settings = {
        ...settings,
        proxy: {
          ...settings.proxy,
          enabled: values.enable,
          server: values.server,
          override: values.override,
        },
      };
      context.settings = settings;
      await persistSettings(dataDir, settings);
    },
  });

  const context: AppContext = {
    appVersion: process.env['npm_package_version'] ?? '0.1.0',
    appDir,
    uiDir,
    dataDir,
    dataFallback: fallback,
    paths,
    log,
    settings,
    repo,
    api,
    kernel: core,
    guard,
    subscription,
    subscriptionProvider,
    ruleProvider,
    async saveSettings(next: Settings) {
      settings = next;
      context.settings = next;
      await persistSettings(dataDir, next);
      log.info('设置已保存');
      return next;
    },
    writeConfig,
    async refreshSubscription() {
      context.subscription.refreshing = true;
      try {
        const hadSubscription = fs.existsSync(paths.subscription);
        const result = await downloadSubscription(
          {
            url: settings.subscription.url,
            interval: settings.subscription.interval,
            useProxy: settings.subscription.useProxy,
            userAgent: settings.subscription.userAgent,
          },
          dataDir,
          settings.core.mixedPort,
        );
        await writeConfig();
        context.subscription.lastOkAt = new Date().toISOString();
        context.subscription.lastError = null;
        context.subscription.bytes = result.bytes;
        log.info({ bytes: result.bytes, proxies: result.proxies }, '订阅已更新');
        const state = core.status().state;
        if (state === 'running' || state === 'adopted') {
          if (hadSubscription) {
            await api.reloadProxyProvider(subscriptionProvider);
          } else {
            const status = await core.restart();
            if (status.state === 'failed') {
              throw new Error(status.error ?? '订阅已更新，但内核重启失败');
            }
          }
        }
        return context.subscription;
      } catch (error) {
        context.subscription.lastError = error instanceof Error ? error.message : String(error);
        log.error({ err: context.subscription.lastError }, '订阅更新失败，保留旧文件');
        throw error;
      } finally {
        context.subscription.refreshing = false;
      }
    },
    syncSubscriptionTimer,
    async restartKernel(): Promise<CoreStatus> {
      return core.restart();
    },
  };

  await writeConfig();

  const app = Fastify({ logger: false });
  const token = options.apiToken ?? process.env['MCP_API_TOKEN'] ?? '';
  if (token !== '') {
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api/')) return;
      if (request.headers['x-api-token'] !== token) {
        return reply.status(401).send({ error: '缺少或错误的 X-Api-Token' });
      }
    });
  }

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof RuleValidationError) {
      return reply.status(400).send({ error: error.message });
    }
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { statusCode?: number }).statusCode;
    const status = statusCode !== undefined && statusCode < 500 ? statusCode : 500;
    log.error({ err: message }, '接口异常');
    return reply.status(status).send({ error: message });
  });

  registerRoutes(app, context);
  registerStatic(app, uiDir);

  await app.listen({ host, port });
  const url = `http://${host}:${port}`;
  log.info({ url, dataDir, fallback }, '服务已启动');

  const coreStatus = await core.start();
  if (coreStatus.state === 'failed') {
    // 内核缺失时降级运行，保证界面可用；页面会显示失败原因
    log.warn({ err: coreStatus.error }, '内核未启动，进入降级模式');
  } else {
    core.watch((failed) => {
      log.error({ err: failed.error }, '内核退出，停止守护类工作');
      // 内核已死，代理指向的端口不再可达，必须关闭系统代理避免整机断网
      void guard.disable().catch((error) => {
        log.error({ err: String(error) }, '内核退出后关闭系统代理失败');
      });
    });
    guard.start();
  }

  context.syncSubscriptionTimer();

  const close = async (): Promise<void> => {
    if (subscriptionTimer !== null) clearInterval(subscriptionTimer);
    guard.stop();
    await core.stop();
    await app.close();
    db.close();
    lock.release();
  };

  return { url, app, context, close };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly || process.env['MCP_STANDALONE'] === '1') {
  const running = await startServer({
    appDir: process.cwd(),
    port: Number(process.env['MCP_PORT'] ?? 8787),
  });
  process.stdout.write(`mihomo-controller-plan 已启动：${running.url}\n`);

  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
