import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readAppConfig, saveAppSettings } from '../../src/app-config.js';
import type { AppContext } from '../../src/context.js';
import type { Rule, RuleInput, RuleRepo } from '../../src/rules/repo.js';
import { DEFAULT_SETTINGS, type Settings } from '../../src/settings.js';
import { DEFAULT_UI_CONFIG, getUiConfig, uiConfigPath } from '../../src/ui-config.js';
import { encodeSharedConfig } from '../../src/ui-config-share.js';
import { createUiConfigService } from '../../src/ui-config-store.js';
import { dataPaths } from '../../src/util/paths.js';

// fastify v5 需要 node:diagnostics_channel.tracingChannel（Node >= 19.9）；
// 低版本 Node 连模块都加载不了，因此动态 import 并按版本跳过。
const canLoadFastify = Number(process.versions.node.split('.')[0] ?? 0) >= 20;

type BuildApp = (dataDir: string, extra?: Record<string, unknown>) => FastifyInstance;

function fakeRepo(): RuleRepo & { current: Rule[] } {
  const rules: Rule[] = [];
  let nextId = 1;
  return {
    current: rules,
    list: () => rules,
    create: (inputs: RuleInput[]) =>
      inputs.map((input) => {
        const rule: Rule = { id: nextId++, position: rules.length, ...input };
        rules.push(rule);
        return rule;
      }),
    update: (id: number, patch: Partial<RuleInput>) => {
      const rule = rules.find((item) => item.id === id);
      if (rule === undefined) throw new Error('规则不存在');
      Object.assign(rule, patch);
      return rule;
    },
    remove: (id: number) => {
      const index = rules.findIndex((item) => item.id === id);
      if (index >= 0) rules.splice(index, 1);
    },
    reorder: () => undefined,
    replaceAll: (inputs: RuleInput[]) => {
      rules.splice(0, rules.length, ...inputs.map((input, index) => ({ id: index + 1, position: index, ...input })));
      return rules;
    },
  };
}

async function createBuilder(): Promise<BuildApp> {
  const [{ default: Fastify }, { registerRoutes }] = await Promise.all([
    import('fastify'),
    import('../../src/routes.js'),
  ]);

  return (dataDir: string, extra: Record<string, unknown> = {}): FastifyInstance => {
    const log = pino({ level: 'silent' });
    const file = uiConfigPath(dataDir);
    // 统一配置文件是唯一真相源：没有就先落下初始化文件
    if (!existsSync(file)) {
      writeFileSync(file, JSON.stringify({ ...DEFAULT_UI_CONFIG, rules: [], initialized: true }));
    }
    const uiConfigService = createUiConfigService(file);
    const repo = fakeRepo();
    const settings = { ...DEFAULT_SETTINGS, core: { ...DEFAULT_SETTINGS.core, binaryPath: process.execPath } };
    const context = {
      appVersion: 'test',
      appDir: dataDir,
      dataDir,
      dataFallback: false,
      paths: dataPaths(dataDir),
      log,
      settings,
      repo,
      subscriptionProvider: 'sub-main',
      ruleProvider: 'custom',
      subscription: {
        url: '',
        useProxy: false,
        userAgent: '',
        lastOkAt: null,
        lastError: null,
        bytes: null,
        refreshing: false,
      },
      api: {
        reloadProxyProvider: async () => undefined,
        reloadRuleProvider: async () => undefined,
      },
      get uiConfig() {
        return getUiConfig();
      },
      uiConfigState: () => uiConfigService.state(),
      applyUiConfig: async (config: unknown) => uiConfigService.apply(config),
      initializeUiConfig: async () => uiConfigService.initialize(),
      renderUiConfigShare: () =>
        uiConfigService.share(repo.list(), {
          core: { binaryPath: settings.core.binaryPath, mixedPort: settings.core.mixedPort },
          proxy: { enabled: settings.proxy.enabled, override: settings.proxy.override },
        }),
      decodeUiConfigShare: (payload: string) => uiConfigService.decode(payload),
      importUiConfigShare: async (payload: string) => uiConfigService.importShared(payload),
      saveSettings: async (next: unknown) => {
        // 真实写回 config.json：导入的应用设置段要能和界面常量段共处一个文件
        await saveAppSettings(file, next as Settings);
        (extra['saved'] as unknown[] | undefined)?.push(next);
        return next;
      },
      writeConfig: async () => undefined,
      kernel: { status: () => ({ state: 'stopped' }), setBinary: () => undefined },
      guard: { setServer: async () => undefined },
      ...extra,
    } as unknown as AppContext;

    const app = Fastify();
    registerRoutes(app, context);
    return app;
  };
}

describe.skipIf(!canLoadFastify)('/api/ui-config', () => {
  let dataDir: string;
  let buildApp: BuildApp;

  beforeAll(async () => {
    buildApp = await createBuilder();
  });

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-routes-'));
  });

  it('GET 返回生效值快照：当前值 + 初始化标记 + 文件修改时间', async () => {
    const app = buildApp(dataDir);
    const response = await app.inject({ method: 'GET', url: '/api/ui-config' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ config: typeof DEFAULT_UI_CONFIG; initialized: boolean; updatedAt: string }>();
    expect(body.config.ruleTypes).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
    expect(body.initialized).toBe(true);
    expect(body.updatedAt).not.toBeNull();
    await app.close();
  });

  it('立即初始化把标记改成 false，文件内容不动', async () => {
    const app = buildApp(dataDir);
    const response = await app.inject({ method: 'POST', url: '/api/ui-config/initialize' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ initialized: boolean }>().initialized).toBe(false);
    const written = readAppConfig(uiConfigPath(dataDir));
    expect(written.initialized).toBe(false);
    expect(written.ui.ruleTypes).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
    await app.close();
  });

  it('GET /share 生成的串能被 /import 收下：界面常量、规则与代理设置一起生效', async () => {
    const app = buildApp(dataDir);
    const payload = encodeSharedConfig({
      config: {
        ...DEFAULT_UI_CONFIG,
        ruleTypes: ['DOMAIN'],
        defaults: { ruleType: 'DOMAIN', policy: 'DIRECT' },
      },
      rules: [{ enabled: true, type: 'DOMAIN', value: 'a.com', policy: 'DIRECT', noResolve: true }],
      app: { proxy: { enabled: true, override: 'localhost;127.*;10.*' } },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/import',
      payload: { payload },
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    const body = response.json<{
      initialized: boolean;
      config: typeof DEFAULT_UI_CONFIG;
      rules: { count: number } | null;
      warnings: string[];
    }>();
    expect(body.initialized).toBe(false);
    expect(body.config.defaults).toEqual({ ruleType: 'DOMAIN', policy: 'DIRECT' });
    expect(body.rules?.count).toBe(1);
    expect(body.warnings).toEqual([]);

    const written = readAppConfig(uiConfigPath(dataDir));
    expect(written.ui.ruleTypes).toEqual(['DOMAIN']);
    expect(written.rules).toHaveLength(1);
    expect(written.settings.proxy.enabled).toBe(true);
    // 订阅不在分享串里，导入后保持本机现状
    expect(written.settings.subscription).toEqual(DEFAULT_SETTINGS.subscription);
    await app.close();
  });

  it('分享串里的内核路径在本机不存在时只提示，不覆盖本机路径', async () => {
    const saved: { core: { binaryPath: string } }[] = [];
    const app = buildApp(dataDir, { saved });
    const payload = encodeSharedConfig({
      config: DEFAULT_UI_CONFIG,
      rules: [],
      app: { core: { binaryPath: 'C:/别的机器/mihomo.exe', mixedPort: 7891 } },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/import',
      payload: { payload },
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    const body = response.json<{ warnings: string[] }>();
    expect(body.warnings[0]).toContain('内核路径在本机不存在');
    expect(saved[0]?.core.binaryPath).toBe(process.execPath);
    await app.close();
  });

  it('导入串不合法一律 400 并带 issues，文件与生效值都不变', async () => {
    const app = buildApp(dataDir);
    const before = readFileSync(uiConfigPath(dataDir), 'utf8');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/ui-config/import',
      payload: { payload: '这不是base64!!' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ issues: { path: string }[] }>().issues[0]?.path).toBe('payload');

    const empty = await app.inject({
      method: 'POST',
      url: '/api/ui-config/import',
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    expect(readFileSync(uiConfigPath(dataDir), 'utf8')).toBe(before);
    expect(getUiConfig().ruleTypes).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
    await app.close();
  });

  it('保存界面常量后就算配置好了（initialized → false）', async () => {
    const app = buildApp(dataDir);
    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/apply',
      payload: {
        config: { ...DEFAULT_UI_CONFIG, defaults: { ruleType: 'DOMAIN', policy: 'DIRECT' } },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ initialized: boolean }>().initialized).toBe(false);
    expect(readAppConfig(uiConfigPath(dataDir)).initialized).toBe(false);
    await app.close();
  });
});
