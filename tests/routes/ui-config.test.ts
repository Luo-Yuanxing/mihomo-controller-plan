import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/context.js';
import { openRulesDatabase, type RulesDatabase } from '../../src/rules/db.js';
import type { Rule, RuleInput, RuleRepo } from '../../src/rules/repo.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { DEFAULT_UI_CONFIG, getUiConfig, uiConfigPath } from '../../src/ui-config.js';
import { createUiConfigService } from '../../src/ui-config-store.js';
import { dataPaths } from '../../src/util/paths.js';

// fastify v5 需要 node:diagnostics_channel.tracingChannel（Node >= 19.9）；
// 低版本 Node 连模块都加载不了，因此动态 import 并按版本跳过。
const canLoadFastify = Number(process.versions.node.split('.')[0] ?? 0) >= 20;

type BuildApp = (dataDir: string) => FastifyInstance;

function fakeRepo(): RuleRepo {
  const rules: Rule[] = [];
  let nextId = 1;
  return {
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
  };
}

const databases: RulesDatabase[] = [];

async function createBuilder(): Promise<BuildApp> {
  const [{ default: Fastify }, { registerRoutes }] = await Promise.all([
    import('fastify'),
    import('../../src/routes.js'),
  ]);

  return (dataDir: string): FastifyInstance => {
    const log = pino({ level: 'silent' });
    const db = openRulesDatabase(dataDir);
    databases.push(db);
    const uiConfigService = createUiConfigService(db, uiConfigPath(dataDir));
    const context = {
      appVersion: 'test',
      appDir: dataDir,
      uiDir: dataDir,
      dataDir,
      dataFallback: false,
      paths: dataPaths(dataDir),
      log,
      settings: DEFAULT_SETTINGS,
      repo: fakeRepo(),
      subscriptionProvider: 'sub-main',
      ruleProvider: 'custom',
      get uiConfig() {
        return getUiConfig();
      },
      uiConfigState: () => uiConfigService.state(),
      forceLoadUiConfig: async (file?: string) => uiConfigService.forceLoad(file),
      previewUiConfig: async (file?: string) => uiConfigService.preview(file),
      applyUiConfig: async (input: { file?: string; config: unknown }) =>
        uiConfigService.apply(input),
    } as unknown as AppContext;

    const app = Fastify();
    registerRoutes(app, context);
    return app;
  };
}

async function createRule(app: FastifyInstance, type: string): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/rules',
    payload: { rules: [{ type, value: 'example.com', policy: 'PROXY' }] },
  });
  return response.statusCode;
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

  afterEach(() => {
    while (databases.length > 0) databases.pop()?.close();
  });

  it('GET 返回系统值（含库里的落盘时间）', async () => {
    const app = buildApp(dataDir);
    const response = await app.inject({ method: 'GET', url: '/api/ui-config' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      file: string;
      updatedAt: string;
      config: typeof DEFAULT_UI_CONFIG;
    }>();
    expect(body.file).toBe(uiConfigPath(dataDir));
    expect(body.updatedAt).not.toBeNull();
    expect(body.config.ruleTypes).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
    await app.close();
  });

  it('预览只对比不生效，强制加载才覆盖', async () => {
    const app = buildApp(dataDir);
    const file = uiConfigPath(dataDir);
    writeFileSync(
      file,
      JSON.stringify({
        ...DEFAULT_UI_CONFIG,
        ruleTypes: ['DOMAIN'],
        defaults: { ...DEFAULT_UI_CONFIG.defaults, ruleType: 'DOMAIN' },
      }),
      'utf8',
    );

    const preview = await app.inject({ method: 'POST', url: '/api/ui-config/preview' });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json<{ same: boolean; diff: { label: string; same: boolean }[] }>();
    expect(previewBody.same).toBe(false);
    expect(previewBody.diff.find((item) => item.label === '规则类型')?.same).toBe(false);
    // 预览不动系统值，白名单仍是默认的两个类型
    expect(await createRule(app, 'DOMAIN')).toBe(201);

    const forced = await app.inject({ method: 'POST', url: '/api/ui-config/load-force' });
    expect(forced.statusCode).toBe(200);
    expect(forced.json<{ config: typeof DEFAULT_UI_CONFIG }>().config.ruleTypes).toEqual([
      'DOMAIN',
    ]);
    expect(await createRule(app, 'DOMAIN-SUFFIX')).toBe(400);
    await app.close();
  });

  it('确认保存把界面值写进系统（不依赖文件）', async () => {
    const app = buildApp(dataDir);
    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/apply',
      payload: {
        file: 'D:/anywhere/mine.json',
        config: { ...DEFAULT_UI_CONFIG, defaults: { ruleType: 'DOMAIN', policy: 'DIRECT' } },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ file: string; config: typeof DEFAULT_UI_CONFIG }>();
    expect(body.file).toBe('D:/anywhere/mine.json');
    expect(body.config.defaults).toEqual({ ruleType: 'DOMAIN', policy: 'DIRECT' });
    await app.close();
  });

  it('配置文件不存在或非法时返回 400', async () => {
    const app = buildApp(dataDir);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/ui-config/preview',
      payload: { file: path.join(dataDir, 'nope.json') },
    });
    expect(missing.statusCode).toBe(400);

    writeFileSync(uiConfigPath(dataDir), '{"ruleTypes": []}', 'utf8');
    const forced = await app.inject({ method: 'POST', url: '/api/ui-config/load-force' });
    expect(forced.statusCode).toBe(400);
    // 失败后系统值保持不变
    expect(await createRule(app, 'DOMAIN-SUFFIX')).toBe(201);
    await app.close();
  });
});
