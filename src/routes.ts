/**
 * REST 接口清单。
 * 计划 §6 接口清单；仅监听 127.0.0.1，由 server 侧校验 X-Api-Token。
 */
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { renderConfig } from './config/template.js';
import type { AppContext } from './context.js';
import { parseFailedConnections } from './logs/failed-connections.js';
import { RuleValidationError, renderRuleProvider } from './rules/render.js';
import { countSubscriptionProxies } from './sub/download.js';
import { syncRules } from './rules/sync.js';
import { settingsSchema } from './settings.js';
import { uiConfigPath } from './ui-config.js';
import { readFileIfExists } from './util/atomic.js';
import { logPaths, tailLines } from './util/logger.js';
import type { RuleInput } from './rules/repo.js';

/** 规则类型白名单来自 data/ui-config.json，每次请求按当前值校验。 */
function ruleSchemas(ruleTypes: readonly string[]) {
  const ruleInputSchema = z.object({
    enabled: z.boolean().default(true),
    // 类型白名单在入口就拦下，避免脏数据进库（计划 §5.4 第 2 步）
    type: z.string().refine((value) => ruleTypes.includes(value), {
      message: `类型不在白名单：${ruleTypes.join(' / ')}`,
    }),
    value: z.string().default(''),
    policy: z.string().min(1),
    noResolve: z.boolean().default(true),
  });
  return {
    rulePatchSchema: ruleInputSchema.partial(),
    createRulesSchema: z.union([
      ruleInputSchema,
      z.array(ruleInputSchema),
      z.object({ rules: z.array(ruleInputSchema) }),
    ]),
  };
}

function invalid(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const detail = error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
  return reply.status(400).send({ error: `请求参数不合法：${detail}` });
}

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/status', async () => ({
    app: {
      version: ctx.appVersion,
      dataDir: ctx.dataDir,
      dataFallback: ctx.dataFallback,
      ruleProvider: ctx.ruleProvider,
      subscriptionProvider: ctx.subscriptionProvider,
    },
    kernel: ctx.kernel.status(),
    subscription: {
      ...ctx.subscription,
      fileExists: fs.existsSync(ctx.paths.subscription),
    },
    proxy: await ctx.guard.state(),
  }));

  app.get('/api/settings', async () => ctx.settings);

  app.put('/api/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);

    const previous = ctx.settings;
    const settings = await ctx.saveSettings(parsed.data);
    ctx.subscription.url = settings.subscription.url;
    ctx.subscription.interval = settings.subscription.interval;
    ctx.subscription.useProxy = settings.subscription.useProxy;
    ctx.subscription.userAgent = settings.subscription.userAgent;
    ctx.syncSubscriptionTimer();
    await ctx.writeConfig();

    const needsRestart =
      previous.core.mixedPort !== settings.core.mixedPort ||
      previous.core.controllerPort !== settings.core.controllerPort ||
      previous.core.secret !== settings.core.secret;
    return { settings, needsRestart };
  });

  app.get('/api/subscription', () => ({
    config: {
      url: ctx.settings.subscription.url,
      interval: ctx.settings.subscription.interval,
      useProxy: ctx.settings.subscription.useProxy,
      userAgent: ctx.settings.subscription.userAgent,
    },
    state: ctx.subscription,
    file: ctx.paths.subscription,
    fileExists: fs.existsSync(ctx.paths.subscription),
  }));

  app.put('/api/subscription', async (request, reply) => {
    const schema = z.object({
      url: z.string().optional(),
      interval: z.number().int().positive().optional(),
      useProxy: z.boolean().optional(),
      userAgent: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);

    const current = ctx.settings.subscription;
    const next = {
      url: parsed.data.url ?? current.url,
      interval: parsed.data.interval ?? current.interval,
      useProxy: parsed.data.useProxy ?? current.useProxy,
      userAgent: parsed.data.userAgent ?? current.userAgent,
    };
    await ctx.saveSettings({ ...ctx.settings, subscription: next });
    ctx.subscription.url = next.url;
    ctx.subscription.interval = next.interval;
    ctx.subscription.useProxy = next.useProxy;
    ctx.subscription.userAgent = next.userAgent;
    ctx.syncSubscriptionTimer();
    await ctx.writeConfig();
    return { config: next };
  });

  app.delete('/api/subscription', async () => {
    const previous = ctx.settings.subscription;
    const deleted = fs.existsSync(ctx.paths.subscription);
    const next = {
      ...previous,
      url: '',
    };
    await ctx.saveSettings({ ...ctx.settings, subscription: next });
    ctx.subscription.url = '';
    ctx.syncSubscriptionTimer();

    try {
      fs.rmSync(ctx.paths.subscription, { force: true });
    } catch (error) {
      await ctx.saveSettings({ ...ctx.settings, subscription: previous });
      ctx.subscription.url = previous.url;
      ctx.syncSubscriptionTimer();
      throw error;
    }

    ctx.subscription.lastOkAt = null;
    ctx.subscription.lastError = null;
    ctx.subscription.bytes = null;
    await ctx.writeConfig();

    const state = ctx.kernel.status().state;
    const kernel =
      state === 'running' || state === 'adopted' ? await ctx.restartKernel() : ctx.kernel.status();
    return { deleted, config: next, kernel };
  });

  app.post('/api/subscription/refresh', async (request, reply) => {
    try {
      return await ctx.refreshSubscription();
    } catch (error) {
      return reply.status(502).send({
        error: error instanceof Error ? error.message : String(error),
        state: ctx.subscription,
      });
    }
  });

  app.get('/api/failed-connections', (request) => {
    const lines = Number((request.query as { lines?: string }).lines ?? 5000);
    const maxLines = Number.isInteger(lines) && lines > 0 && lines <= 20_000 ? lines : 5000;
    const file = logPaths(ctx.dataDir).core;
    const scanned = tailLines(file, maxLines);
    return {
      file,
      scannedLines: scanned.length,
      connections: parseFailedConnections(scanned),
    };
  });

  app.get('/api/rules', () => ({ rules: ctx.repo.list(), provider: ctx.ruleProvider }));

  app.get('/api/ui-config', () => ({
    file: uiConfigPath(ctx.dataDir),
    config: ctx.uiConfig,
  }));

  app.post('/api/ui-config/reload', async (_request, reply) => {
    const state = await ctx.reloadUiConfig();
    if (state.error !== null) {
      return reply.status(400).send({ error: `界面常量不合法，已回退默认值：${state.error}` });
    }
    return { file: state.file, config: state.config };
  });

  app.get('/api/rules/provider', async () => {
    const file = `${ctx.paths.rulesDir}/${ctx.ruleProvider}.yaml`;
    const yaml = await readFileIfExists(file);
    return {
      file,
      exists: yaml !== null,
      yaml: yaml ?? renderRuleProvider(ctx.repo.list()),
    };
  });

  app.post('/api/rules', async (request, reply) => {
    const parsed = ruleSchemas(ctx.uiConfig.ruleTypes).createRulesSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);

    const inputs = Array.isArray(parsed.data)
      ? parsed.data
      : 'rules' in parsed.data
        ? parsed.data.rules
        : [parsed.data];
    const created = ctx.repo.create(inputs);
    ctx.log.info({ count: created.length }, '新增规则');
    return reply.status(201).send({ created });
  });

  app.put('/api/rules/order', async (request, reply) => {
    const parsed = z.object({ ids: z.array(z.number().int().positive()) }).safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    ctx.repo.reorder(parsed.data.ids);
    return { rules: ctx.repo.list() };
  });

  app.put('/api/rules/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'id 不合法' });
    const parsed = ruleSchemas(ctx.uiConfig.ruleTypes).rulePatchSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const patch: Partial<RuleInput> = {};
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if (parsed.data.type !== undefined) patch.type = parsed.data.type;
    if (parsed.data.value !== undefined) patch.value = parsed.data.value;
    if (parsed.data.policy !== undefined) patch.policy = parsed.data.policy;
    if (parsed.data.noResolve !== undefined) patch.noResolve = parsed.data.noResolve;
    return { rule: ctx.repo.update(id, patch) };
  });

  app.delete('/api/rules/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'id 不合法' });
    ctx.repo.remove(id);
    return { rules: ctx.repo.list() };
  });

  app.post('/api/rules/sync', async (request, reply) => {
    const parsed = z.object({ force: z.boolean().optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      const result = await syncRules({
        repo: ctx.repo,
        api: ctx.api,
        dataDir: ctx.dataDir,
        providerName: ctx.ruleProvider,
        ...(parsed.data.force === undefined ? {} : { force: parsed.data.force }),
      });
      ctx.log.info(result, '规则热更新完成');
      return { ...result, provider: ctx.ruleProvider };
    } catch (error) {
      // 规则本身不合法属于输入类错误，交给统一错误处理返回 400
      if (error instanceof RuleValidationError) throw error;
      return reply.status(502).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/proxy', () => ctx.guard.state());

  app.post('/api/proxy/enable', async () => {
    const state = await ctx.guard.enable();
    ctx.log.info('系统代理已开启并纳入守护');
    return state;
  });

  app.post('/api/proxy/disable', async () => {
    const state = await ctx.guard.disable();
    ctx.log.info('系统代理已关闭并交还控制权');
    return state;
  });

  app.post('/api/proxy/apply', async () => ctx.guard.apply());

  app.post('/api/kernel/restart', async () => {
    await ctx.writeConfig();
    return ctx.restartKernel();
  });

  app.post('/api/kernel/start', async () => {
    const status = await ctx.kernel.start();
    ctx.log.info({ state: status.state }, '内核启动完成');
    return status;
  });

  app.post('/api/kernel/stop', async () => {
    await ctx.kernel.stop();
    ctx.log.info('内核已停止');
    return ctx.kernel.status();
  });

  app.get('/api/logs', (request) => {
    const lines = Number((request.query as { lines?: string }).lines ?? 200);
    const max = Number.isInteger(lines) && lines > 0 && lines <= 2000 ? lines : 200;
    const paths = logPaths(ctx.dataDir);
    return { app: tailLines(paths.app, max), core: tailLines(paths.core, max) };
  });

  app.get('/api/config', async () => {
    const yaml = await readFileIfExists(ctx.paths.config);
    return {
      file: ctx.paths.config,
      yaml:
        yaml ??
        renderConfig({
          settings: ctx.settings,
          secret: ctx.settings.core.secret,
          subscriptionProvider: countSubscriptionProxies(ctx.paths.subscription) > 0
            ? ctx.subscriptionProvider
            : null,
          ruleProvider: ctx.ruleProvider,
        }),
    };
  });
}
