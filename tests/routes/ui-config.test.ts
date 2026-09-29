import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/context.js';
import type { Rule, RuleInput, RuleRepo } from '../../src/rules/repo.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import {
  DEFAULT_UI_CONFIG,
  getUiConfig,
  loadUiConfig,
  uiConfigPath,
} from '../../src/ui-config.js';
import { dataPaths } from '../../src/util/paths.js';

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

type BuildApp = (dataDir: string) => FastifyInstance;

async function createBuilder(): Promise<BuildApp> {
  const [{ default: Fastify }, { registerRoutes }] = await Promise.all([
    import('fastify'),
    import('../../src/routes.js'),
  ]);
  return (dataDir: string): FastifyInstance => {
  const log = pino({ level: 'silent' });
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
    reloadUiConfig: () => loadUiConfig(dataDir, log),
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

// fastify v5 需要 node:diagnostics_channel.tracingChannel（Node >= 19.9），
// 低版本 Node 连模块都加载不了，这里直接跳过；项目本身要求 Node >= 22（或用 Electron 内置 Node 跑）。
const canLoadFastify = Number(process.versions.node.split('.')[0] ?? 0) >= 20;

describe.skipIf(!canLoadFastify)('/api/ui-config', () => {
  let dataDir: string;
  let buildApp: BuildApp;

  beforeAll(async () => {
    buildApp = await createBuilder();
  });

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-routes-'));
    await loadUiConfig(dataDir);
  });

  it('GET 返回当前生效常量与文件路径', async () => {
    const app = buildApp(dataDir);
    const response = await app.inject({ method: 'GET', url: '/api/ui-config' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ file: string; config: typeof DEFAULT_UI_CONFIG }>();
    expect(body.file).toBe(uiConfigPath(dataDir));
    expect(body.config.ruleTypes).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
    await app.close();
  });

  it('重载后白名单立即变化，并被 /api/rules 校验采用', async () => {
    const app = buildApp(dataDir);
    expect(await createRule(app, 'DOMAIN-KEYWORD')).toBe(400);

    writeFileSync(
      uiConfigPath(dataDir),
      JSON.stringify({ ...DEFAULT_UI_CONFIG, ruleTypes: ['DOMAIN-KEYWORD'] }),
      'utf8',
    );
    const reloaded = await app.inject({ method: 'POST', url: '/api/ui-config/reload' });
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json<{ config: typeof DEFAULT_UI_CONFIG }>().config.ruleTypes).toEqual([
      'DOMAIN-KEYWORD',
    ]);

    expect(await createRule(app, 'DOMAIN-KEYWORD')).toBe(201);
    expect(await createRule(app, 'DOMAIN')).toBe(400);
    await app.close();
  });

  it('非法 JSON 返回 400 并回退默认白名单', async () => {
    const app = buildApp(dataDir);
    writeFileSync(uiConfigPath(dataDir), '{"ruleTypes": []}', 'utf8');

    const response = await app.inject({ method: 'POST', url: '/api/ui-config/reload' });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain('已回退默认值');
    expect(await createRule(app, 'DOMAIN-SUFFIX')).toBe(201);
    await app.close();
  });
});
