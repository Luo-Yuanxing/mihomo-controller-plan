/**
 * REST 接口清单。
 * 计划 §6 接口清单；仅监听 127.0.0.1，由 server 侧校验 X-Api-Token。
 */
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PROXY_GROUP_NAME } from './config/template.js';
import type { AppContext } from './context.js';
import { CoreApiError, DELAY_TEST_URL, proxyGroups } from './core/api.js';
import { parseFailedConnections } from './logs/failed-connections.js';
import { RuleValidationError, renderRuleProvider } from './rules/render.js';
import { readSubscription } from './sub/subscription.js';
import { syncRules } from './rules/sync.js';
import { settingsSchema } from './settings.js';
import type { Settings } from './settings.js';
import {
  renderUiConfigFile,
  resolveExportTarget,
  UiConfigValidationError,
  type RuleEntry,
} from './ui-config.js';
import { readFileIfExists, writeFileAtomic } from './util/atomic.js';
import { resolveBinaryPath } from './util/paths.js';
import { logPaths, tailLines } from './util/logger.js';
import type { RuleInput } from './rules/repo.js';

/** 规则类型白名单来自统一配置文件 config.json，每次请求按当前值校验。 */
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
    createRulesSchema: z.object({ rules: z.array(ruleInputSchema) }),
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

  /** 离线探测：界面进入离线状态后每秒问候一次，通了就解除。 */
  app.get('/api/ping', () => ({ ok: true }));

  /** 离线兜底一：完全关闭代理 = 停内核 + 关系统代理。 */
  app.post('/api/offline/shutdown', async () => {
    await ctx.kernel.stop();
    const proxy = await ctx.guard.disable();
    ctx.log.warn('离线兜底：已关闭系统代理并停止内核');
    return { kernel: ctx.kernel.status(), proxy };
  });

  /** 离线兜底二：无条件写一遍系统代理期望值，重写配置后重启内核。 */
  app.post('/api/offline/restart', async () => {
    const proxy = await ctx.guard.apply();
    await ctx.writeConfig();
    const kernel = await ctx.restartKernel();
    ctx.log.warn({ state: kernel.state }, '离线兜底：已重启内核');
    return { kernel, proxy };
  });

  /**
   * 一键修复：重写配置 → 内核没起来就重启 → 内核就绪才写系统代理，没起来就关掉代理。
   * 最后一步是关键：内核不可用时宁可关代理，也不能让整机流量指向一个没人监听的端口。
   */
  app.post('/api/recover', async () => {
    const steps: string[] = [];

    try {
      await ctx.writeConfig();
      steps.push('已按当前设置重写 config.yaml');
    } catch (error) {
      steps.push(`重写配置失败：${errorText(error)}`);
    }

    let kernel = ctx.kernel.status();
    if (kernel.state === 'running' || kernel.state === 'adopted') {
      steps.push('内核已在运行');
    } else {
      kernel = await ctx.restartKernel();
      steps.push(
        kernel.state === 'failed' ? `内核启动失败：${kernel.error ?? '未知原因'}` : '内核已启动',
      );
    }

    const kernelUp = kernel.state === 'running' || kernel.state === 'adopted';
    // 联动只往一个方向走：内核在跑就把系统代理指向它，没跑就关掉（反向不动内核）
    const proxy = kernelUp ? await ctx.guard.enable() : await ctx.guard.disable();
    steps.push(kernelUp ? '内核已就绪，系统代理已指向内核' : '内核不可用，已关闭系统代理以免整机断网');
    ctx.log.warn({ steps }, '一键修复完成');
    return { steps, kernel, proxy };
  });

  app.get('/api/settings', async () => ctx.settings);

  /** 保存设置后已经落盘、但后续动作失败：带状态码交给调用方回。 */
  class SettingsApplyError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = 'SettingsApplyError';
    }
  }

  /**
   * 保存设置并做完副作用：路径校验 → 落盘 → 通知内核/守护 → 重写 config.yaml，
   * 换了 PROXY 指代就重建代理组。PUT /api/settings 与"按配置文件加载"共用。
   */
  const applySettings = async (
    next: Settings,
  ): Promise<{ settings: Settings; needsRestart: boolean; groupsRebuilt: boolean }> => {
    // 内核路径和界面常量配置文件一样：解析成绝对路径并落盘，路径不存在直接拒绝
    const binaryPath = resolveBinaryPath(ctx.appDir, next.core.binaryPath);

    const previous = ctx.settings;
    const settings = await ctx.saveSettings({
      ...next,
      core: { ...next.core, binaryPath },
    });
    ctx.kernel.setBinary(binaryPath);
    // 混合端口变了，系统代理要跟着指向新端口
    if (previous.core.mixedPort !== settings.core.mixedPort) {
      await ctx.guard.setServer(`127.0.0.1:${settings.core.mixedPort}`);
    }
    ctx.subscription.url = settings.subscription.url;
    ctx.subscription.useProxy = settings.subscription.useProxy;
    ctx.subscription.userAgent = settings.subscription.userAgent;
    await ctx.writeConfig();

    const needsRestart =
      previous.core.mixedPort !== settings.core.mixedPort ||
      previous.core.secret !== settings.core.secret;

    // 换了指代的组，代理组结构就变了：不重建的话界面列的还是旧组的节点
    if (previous.subscription.proxyGroup !== settings.subscription.proxyGroup) {
      const state = ctx.kernel.status().state;
      if (state === 'running' || state === 'adopted') {
        const status = await ctx.kernel.restart();
        if (status.state === 'failed') {
          throw new SettingsApplyError(
            `设置已保存，但内核重启失败：${status.error ?? '未知原因'}`,
            502,
          );
        }
        return { settings, needsRestart, groupsRebuilt: true };
      }
    }

    return { settings, needsRestart, groupsRebuilt: false };
  };

  app.put('/api/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return await applySettings(parsed.data);
    } catch (error) {
      const status = error instanceof SettingsApplyError ? error.status : 400;
      return reply.status(status).send({ error: errorText(error) });
    }
  });

  /** 订阅文件里的代理组：设置页用它选"PROXY 指代哪个组"。 */
  app.get('/api/subscription/groups', () => {
    const subscription = readSubscription(ctx.paths.subscription);
    return {
      file: ctx.paths.subscription,
      exists: subscription.proxies > 0,
      selected: ctx.settings.subscription.proxyGroup,
      groups: subscription.groups.map((group) => ({
        name: group.name,
        type: group.type,
        members: group.members.length,
      })),
    };
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

    try {
      fs.rmSync(ctx.paths.subscription, { force: true });
    } catch (error) {
      await ctx.saveSettings({ ...ctx.settings, subscription: previous });
      ctx.subscription.url = previous.url;
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

  /** 配置文件里的 rules 段：整表覆盖库里的规则并热更新；没有 rules 段就完全不动规则。 */
  const applyRulesFromConfig = async (
    entries: RuleEntry[] | null,
  ): Promise<{ count: number; changed: boolean } | null> => {
    if (entries === null) return null;
    ctx.repo.replaceAll(entries);
    const result = await syncRules({
      repo: ctx.repo,
      api: ctx.api,
      dataDir: ctx.dataDir,
      providerName: ctx.ruleProvider,
    });
    return { count: entries.length, changed: result.changed };
  };

  /** 强制按配置文件加载：直接覆盖生效值。 */
  app.post('/api/ui-config/load-force', async (request, reply) => {
    const parsed = uiConfigFileSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      // 先只读一遍：应用设置要能在动任何状态之前就校验失败
      const peek = await ctx.previewUiConfig(parsed.data.file);
      if (peek.app !== null) {
        const current = ctx.settings;
        const app = peek.app;
        // 文件里没带的字段保持现状（空串也是有意义的值，所以用 ?? 而不是 ||）
        await applySettings({
          core: {
            binaryPath: app.core?.binaryPath ?? current.core.binaryPath,
            mixedPort: app.core?.mixedPort ?? current.core.mixedPort,
            secret: current.core.secret,
          },
          subscription: {
            url: app.subscription?.url ?? current.subscription.url,
            useProxy: app.subscription?.useProxy ?? current.subscription.useProxy,
            userAgent: app.subscription?.userAgent ?? current.subscription.userAgent,
            proxyGroup: app.subscription?.proxyGroup ?? current.subscription.proxyGroup,
          },
          proxy: {
            enabled: current.proxy.enabled,
            override: app.proxy?.override ?? current.proxy.override,
          },
        });
      }
      const loaded = await ctx.forceLoadUiConfig(peek.file);
      return { ...loaded.state, rules: await applyRulesFromConfig(loaded.rules) };
    } catch (error) {
      if (error instanceof SettingsApplyError) {
        return reply.status(error.status).send({ error: errorText(error) });
      }
      return uiConfigFailure(reply, error);
    }
  });

  /** 导出配置：界面常量 + 自定义规则写成一个 config.json。 */
  app.post('/api/ui-config/export', async (request, reply) => {
    const parsed = uiConfigFileSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      const state = ctx.uiConfigState();
      const target = resolveExportTarget(parsed.data.file ?? state.file);
      const json = renderUiConfigFile(state.config, ctx.repo.list(), {
        core: {
          binaryPath: ctx.settings.core.binaryPath,
          mixedPort: ctx.settings.core.mixedPort,
        },
        subscription: {
          url: ctx.settings.subscription.url,
          useProxy: ctx.settings.subscription.useProxy,
          userAgent: ctx.settings.subscription.userAgent,
          proxyGroup: ctx.settings.subscription.proxyGroup,
        },
        proxy: { override: ctx.settings.proxy.override },
      });
      await writeFileAtomic(target, json);
      ctx.log.info({ file: target }, '配置已导出');
      return { file: target, rules: ctx.repo.list().length, bytes: Buffer.byteLength(json) };
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
      return {
        ...preview,
        same: preview.diff.every((item) => item.same),
        rules: preview.rules === null ? null : preview.rules.length,
      };
    } catch (error) {
      return uiConfigFailure(reply, error);
    }
  });

  /** 从界面保存到系统：校验后写回统一配置文件并立即生效。 */
  app.post('/api/ui-config/apply', async (request, reply) => {
    const parsed = uiConfigFileSchema.extend({ config: z.unknown() }).safeParse(request.body ?? {});
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      const result = await ctx.applyUiConfig({
        ...(parsed.data.file === undefined ? {} : { file: parsed.data.file }),
        config: parsed.data.config,
      });
      // 和 load-force 一样返回生效值快照本身（界面直接读 file/config/updatedAt）
      return { ...result.state, rules: result.rules };
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

    const created = ctx.repo.create(parsed.data.rules);
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
      return { target: PROXY_GROUP_NAME, groups: proxyGroups(await ctx.api.proxies()) };
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

  /** 测代理组里每个节点的时延；测不通的节点不会出现在 delays 里。 */
  app.get('/api/proxies/:group/delay', async (request, reply) => {
    const { group } = request.params as { group: string };
    try {
      return { group, url: DELAY_TEST_URL, delays: await ctx.api.groupDelay(group) };
    } catch (error) {
      if (error instanceof CoreApiError && error.status === 404) {
        return reply.status(404).send({ error: `代理组不存在：${group}` });
      }
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
    const status = await ctx.startKernel();
    ctx.log.info({ state: status.state }, '内核启动完成');
    return status;
  });

  app.post('/api/kernel/stop', async () => {
    const status = await ctx.stopKernel();
    ctx.log.info({ state: status.state }, '内核已停止');
    return status;
  });

  app.get('/api/logs', (request) => {
    const lines = Number((request.query as { lines?: string }).lines ?? 200);
    const max = Number.isInteger(lines) && lines > 0 && lines <= 2000 ? lines : 200;
    const paths = logPaths(ctx.dataDir);
    return { app: tailLines(paths.app, max), core: tailLines(paths.core, max) };
  });

  /** 生成物随时可重建：读之前先按当前设置重写一遍，保证内容与内存里的状态一致。 */
  app.get('/api/config', async () => {
    await ctx.writeConfig();
    return { file: ctx.paths.config, yaml: (await readFileIfExists(ctx.paths.config)) ?? '' };
  });
}
