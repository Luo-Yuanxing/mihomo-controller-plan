/**
 * REST 接口清单。
 * 计划 §6 接口清单；仅监听 127.0.0.1，由 server 侧校验 X-Api-Token。
 */
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { renderConfig } from './config/template.js';
import type { AppContext } from './context.js';
import { proxyGroups } from './core/api.js';
import { parseFailedConnections } from './logs/failed-connections.js';
import { RuleValidationError, renderRuleProvider } from './rules/render.js';
import { countSubscriptionProxies } from './sub/download.js';
import { planProxyGroups, readSubscriptionGroups } from './sub/groups.js';
import { syncRules } from './rules/sync.js';
import { settingsSchema } from './settings.js';
import { UiConfigValidationError } from './ui-config.js';
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

const selectProxySchema = z.object({ name: z.string().min(1) });

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      previous.core.secret !== settings.core.secret ||
      // 代理组结构变了要多一次重启才会进内核
      previous.subscription.proxyGroup !== settings.subscription.proxyGroup;
    return { settings, needsRestart };
  });

  /** 订阅文件里的代理组：设置页用它选"PROXY 指代哪个组"。 */
  app.get('/api/subscription/groups', () => ({
    file: ctx.paths.subscription,
    exists: countSubscriptionProxies(ctx.paths.subscription) > 0,
    selected: ctx.settings.subscription.proxyGroup,
    groups: readSubscriptionGroups(ctx.paths.subscription).groups.map((group) => ({
      name: group.name,
      type: group.type,
      members: group.members.length,
    })),
  }));

  app.get('/api/subscription', () => ({
    config: {
      url: ctx.settings.subscription.url,
      interval: ctx.settings.subscription.interval,
      useProxy: ctx.settings.subscription.useProxy,
      userAgent: ctx.settings.subscription.userAgent,
      proxyGroup: ctx.settings.subscription.proxyGroup,
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
      proxyGroup: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);

    const current = ctx.settings.subscription;
    const next = {
      url: parsed.data.url ?? current.url,
      interval: parsed.data.interval ?? current.interval,
      useProxy: parsed.data.useProxy ?? current.useProxy,
      userAgent: parsed.data.userAgent ?? current.userAgent,
      proxyGroup: parsed.data.proxyGroup ?? current.proxyGroup,
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

  // 路径本身（非空、.json、存在且是文件）由 resolveConfigFile 严格校验
  const uiConfigFileSchema = z.object({ file: z.string().trim().min(1).max(512).optional() });

  /** 取值不合法时返回 400 + 逐项明细，界面按字段展示。 */
  const uiConfigFailure = (reply: FastifyReply, error: unknown): FastifyReply => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UiConfigValidationError) {
      return reply.status(400).send({ error: message, issues: error.issues });
    }
    return reply.status(400).send({ error: message });
  };

  app.get('/api/ui-config', () => ctx.uiConfigState());

  /** 强制按配置文件加载：直接覆盖系统值。 */
  app.post('/api/ui-config/load-force', async (request, reply) => {
    const parsed = uiConfigFileSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return await ctx.forceLoadUiConfig(parsed.data.file);
    } catch (error) {
      return uiConfigFailure(reply, error);
    }
  });

  /** 预览加载：只对比不生效，返回逐项 diff 供界面标红。 */
  app.post('/api/ui-config/preview', async (request, reply) => {
    const parsed = uiConfigFileSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      const preview = await ctx.previewUiConfig(parsed.data.file);
      return { ...preview, same: preview.diff.every((item) => item.same) };
    } catch (error) {
      return uiConfigFailure(reply, error);
    }
  });

  /** 从界面保存到系统：校验后持久化并立即生效。 */
  app.post('/api/ui-config/apply', async (request, reply) => {
    const parsed = uiConfigFileSchema.extend({ config: z.unknown() }).safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return await ctx.applyUiConfig({
        ...(parsed.data.file === undefined ? {} : { file: parsed.data.file }),
        config: parsed.data.config,
      });
    } catch (error) {
      return uiConfigFailure(reply, error);
    }
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

  /**
   * 目标策略里的"代理"统一落到 PROXY 组，具体走哪个节点由用户在这里选。
   * 列表与当前出口都取内核实时状态，不落库。
   */
  app.get('/api/proxies', async (_request, reply) => {
    try {
      return { groups: proxyGroups(await ctx.api.proxies()) };
    } catch (error) {
      return reply.status(502).send({ error: errorText(error) });
    }
  });

  /** 切组内出口：先按内核快照校验节点属于该组，再写回内核。 */
  app.put('/api/proxies/:group', async (request, reply) => {
    const parsed = selectProxySchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { group } = request.params as { group: string };
    try {
      const snapshot = await ctx.api.proxies();
      const entry = snapshot[group];
      if (entry === undefined) {
        return reply.status(404).send({ error: `代理组不存在：${group}` });
      }
      const all = entry.all ?? [];
      if (!all.includes(parsed.data.name)) {
        return reply.status(400).send({ error: `节点不在代理组 ${group} 中：${parsed.data.name}` });
      }
      await ctx.api.selectProxy(group, parsed.data.name);
      return { group, now: parsed.data.name, all };
    } catch (error) {
      return reply.status(502).send({ error: errorText(error) });
    }
  });

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
    const subscriptionProvider =
      countSubscriptionProxies(ctx.paths.subscription) > 0 ? ctx.subscriptionProvider : null;
    return {
      file: ctx.paths.config,
      yaml:
        yaml ??
        renderConfig({
          settings: ctx.settings,
          secret: ctx.settings.core.secret,
          subscriptionProvider,
          ruleProvider: ctx.ruleProvider,
          proxyGroupPlan:
            subscriptionProvider === null
              ? null
              : planProxyGroups({
                  file: ctx.paths.subscription,
                  chosen: ctx.settings.subscription.proxyGroup,
                }),
        }),
    };
  });
}
