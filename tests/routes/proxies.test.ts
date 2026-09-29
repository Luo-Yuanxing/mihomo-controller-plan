import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/context.js';
import type { CoreApi, ProxySnapshot } from '../../src/core/api.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { DEFAULT_UI_CONFIG, getUiConfig } from '../../src/ui-config.js';

// 与 routes/ui-config.test.ts 同一门槛：fastify v5 需要 Node >= 20。
const canLoadFastify = Number(process.versions.node.split('.')[0] ?? 0) >= 20;

const SNAPSHOT: ProxySnapshot = {
  PROXY: { name: 'PROXY', type: 'Selector', now: '香港', all: ['香港', '日本'] },
  GLOBAL: { name: 'GLOBAL', type: 'Selector', now: 'PROXY', all: ['PROXY'] },
  香港: { name: '香港', type: 'Vless' },
  日本: { name: '日本', type: 'Vless' },
};

interface FakeApi extends CoreApi {
  readonly selected: { group: string; choice: string }[];
}

function fakeApi(delays: Record<string, number> = { 香港: 123 }): FakeApi {
  const selected: { group: string; choice: string }[] = [];
  return {
    selected,
    version: async () => ({ version: 'test', meta: true }),
    reloadRuleProvider: async () => undefined,
    reloadProxyProvider: async () => undefined,
    proxies: async () => SNAPSHOT,
    selectProxy: async (group, choice) => {
      selected.push({ group, choice });
    },
    groupDelay: async () => delays,
    configs: async () => ({}),
    rules: async () => ({}),
  };
}

const SUBSCRIPTION = `
proxies:
  - { name: '香港', type: vless, server: hk.example.com, port: 443 }
  - { name: '日本', type: vless, server: jp.example.com, port: 443 }
proxy-groups:
  - { name: Proxy, type: select, proxies: ['香港', '日本'] }
  - { name: failover, type: fallback, proxies: ['香港', '日本'], url: 'http://www.gstatic.com/generate_204', interval: 300 }
`;

type BuildApp = (api: CoreApi, extra?: Record<string, unknown>) => FastifyInstance;

async function createBuilder(): Promise<BuildApp> {
  const [{ default: Fastify }, { registerRoutes }] = await Promise.all([
    import('fastify'),
    import('../../src/routes.js'),
  ]);

  return (api: CoreApi, extra: Record<string, unknown> = {}): FastifyInstance => {
    const context = {
      appVersion: 'test',
      appDir: '',
      dataDir: '',
      dataFallback: false,
      log: pino({ level: 'silent' }),
      api,
      settings: DEFAULT_SETTINGS,
      ...extra,
      get uiConfig() {
        return getUiConfig();
      },
    } as unknown as AppContext;
    const app = Fastify();
    registerRoutes(app, context);
    return app;
  };
}

describe.skipIf(!canLoadFastify)('/api/proxies', () => {
  let buildApp: BuildApp;

  beforeAll(async () => {
    buildApp = await createBuilder();
  });

  it('只返回代理组，不含节点', async () => {
    const app = buildApp(fakeApi());
    const response = await app.inject({ method: 'GET', url: '/api/proxies' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      target: string;
      groups: { name: string; now: string; all: string[] }[];
    }>();
    expect(body.target).toBe('PROXY');
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.name).toBe('PROXY');
    expect(body.groups[0]?.now).toBe('香港');
    expect(DEFAULT_UI_CONFIG.policies.map((policy) => policy.value)).toContain('PROXY');
    await app.close();
  });

  it('切到组内节点时写回内核', async () => {
    const api = fakeApi();
    const app = buildApp(api);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/proxies/PROXY',
      payload: { name: '日本' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ now: string }>().now).toBe('日本');
    expect(api.selected).toEqual([{ group: 'PROXY', choice: '日本' }]);
    await app.close();
  });

  it('组外节点与不存在的组都拒绝，且不写内核', async () => {
    const api = fakeApi();
    const app = buildApp(api);
    const outside = await app.inject({
      method: 'PUT',
      url: '/api/proxies/PROXY',
      payload: { name: '不存在的节点' },
    });
    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/proxies/OTHER',
      payload: { name: '香港' },
    });
    const empty = await app.inject({
      method: 'PUT',
      url: '/api/proxies/PROXY',
      payload: { name: '' },
    });

    expect(outside.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(404);
    expect(empty.statusCode).toBe(400);
    expect(api.selected).toEqual([]);
    await app.close();
  });

  it('测延迟返回每个节点的毫秒数，没测通的节点不在结果里', async () => {
    const app = buildApp(fakeApi({ 香港: 123 }));
    const response = await app.inject({ method: 'GET', url: '/api/proxies/PROXY/delay' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ group: string; delays: Record<string, number> }>();
    expect(body.group).toBe('PROXY');
    expect(body.delays).toEqual({ 香港: 123 });
    await app.close();
  });
});

describe.skipIf(!canLoadFastify)('/api/subscription/groups', () => {
  let buildApp: BuildApp;

  beforeAll(async () => {
    buildApp = await createBuilder();
  });

  it('列出订阅里的组与当前选择', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-groups-'));
    const subscription = path.join(dir, 'subscription.yaml');
    writeFileSync(subscription, SUBSCRIPTION, 'utf8');

    const app = buildApp(fakeApi(), {
      paths: { subscription },
      settings: {
        ...DEFAULT_SETTINGS,
        subscription: { ...DEFAULT_SETTINGS.subscription, proxyGroup: 'Proxy' },
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/subscription/groups' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      file: subscription,
      exists: true,
      selected: 'Proxy',
      groups: [
        { name: 'Proxy', type: 'select', members: 2 },
        { name: 'failover', type: 'fallback', members: 2 },
      ],
    });
    await app.close();
  });
});

describe.skipIf(!canLoadFastify)('PUT /api/settings', () => {
  let buildApp: BuildApp;

  beforeAll(async () => {
    buildApp = await createBuilder();
  });

  function withProxyGroup(proxyGroup: string) {
    return {
      ...DEFAULT_SETTINGS,
      core: { ...DEFAULT_SETTINGS.core, binaryPath: process.execPath },
      subscription: { ...DEFAULT_SETTINGS.subscription, proxyGroup },
    };
  }

  const extra = () => {
    const restarts: string[] = [];
    return {
      restarts,
      context: {
        subscription: {
          url: '',
          useProxy: false,
          userAgent: '',
          lastOkAt: null,
          lastError: null,
          bytes: null,
          refreshing: false,
        },
        saveSettings: async (next: unknown) => next,
        writeConfig: async () => undefined,
        kernel: {
          status: () => ({ state: 'running' }),
          restart: async () => {
            restarts.push('restart');
            return { state: 'running' };
          },
          setBinary: () => undefined,
        },
        guard: { setServer: async () => undefined },
      },
    };
  };

  it('换了 PROXY 指代的组就重建代理组（重启内核）', async () => {
    const { restarts, context } = extra();
    const app = buildApp(fakeApi(), { ...context, settings: withProxyGroup('Proxy') });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: withProxyGroup('failover'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ groupsRebuilt: boolean }>().groupsRebuilt).toBe(true);
    expect(restarts).toHaveLength(1);
    await app.close();
  });

  it('只改端口不重建代理组，只提示需要重启', async () => {
    const { restarts, context } = extra();
    const app = buildApp(fakeApi(), { ...context, settings: withProxyGroup('Proxy') });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...withProxyGroup('Proxy'), core: { ...DEFAULT_SETTINGS.core, mixedPort: 7891 } },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ groupsRebuilt: boolean; needsRestart: boolean }>();
    expect(body.groupsRebuilt).toBe(false);
    expect(body.needsRestart).toBe(true);
    expect(restarts).toHaveLength(0);
    await app.close();
  });

  it('内核路径不存在直接 400，不落库也不重启', async () => {
    const { restarts, context } = extra();
    const app = buildApp(fakeApi(), { ...context, settings: withProxyGroup('Proxy') });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        ...withProxyGroup('Proxy'),
        core: { ...DEFAULT_SETTINGS.core, binaryPath: 'resources/bin/没有这个.exe' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain('不存在或不可读');
    expect(restarts).toHaveLength(0);
    await app.close();
  });
});

describe.skipIf(!canLoadFastify)('POST /api/ui-config/export', () => {
  let buildApp: BuildApp;

  beforeAll(async () => {
    buildApp = await createBuilder();
  });

  it('界面常量与自定义规则写进同一个 config.json', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-export-'));
    const target = path.join(dir, 'backup.json');
    const app = buildApp(fakeApi(), {
      repo: {
        list: () => [
          {
            id: 1,
            position: 1,
            enabled: true,
            type: 'DOMAIN',
            value: 'a.com',
            policy: 'PROXY',
            noResolve: true,
          },
        ],
      },
      uiConfigState: () => ({
        file: path.join(dir, 'config.json'),
        config: DEFAULT_UI_CONFIG,
        updatedAt: null,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/export',
      payload: { file: target },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ file: string; rules: number }>().rules).toBe(1);

    const written = JSON.parse(readFileSync(target, 'utf8')) as {
      ruleTypes: string[];
      rules: unknown[];
      core: { binaryPath: string; mixedPort: number };
      subscription: Record<string, unknown>;
      proxy: { override: string };
    };
    expect(written.ruleTypes).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
    expect(written.rules).toEqual([
      { enabled: true, type: 'DOMAIN', value: 'a.com', policy: 'PROXY', noResolve: true },
    ]);
    // 设置页那几项也要带上
    expect(written.core).toEqual({
      binaryPath: DEFAULT_SETTINGS.core.binaryPath,
      mixedPort: DEFAULT_SETTINGS.core.mixedPort,
    });
    expect(written.subscription).toEqual({ ...DEFAULT_SETTINGS.subscription });
    expect(written.proxy).toEqual({ override: DEFAULT_SETTINGS.proxy.override });
    await app.close();
  });

  it('导出路径不是 .json 直接 400', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-export-'));
    const app = buildApp(fakeApi(), {
      repo: { list: () => [] },
      uiConfigState: () => ({
        file: path.join(dir, 'config.json'),
        config: DEFAULT_UI_CONFIG,
        updatedAt: null,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/export',
      payload: { file: path.join(dir, 'backup.yaml') },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain('必须以 .json 结尾');
    await app.close();
  });

  it('强制加载配置文件时，rules 段整表写回并热更新', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-load-'));
    const file = path.join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(DEFAULT_UI_CONFIG), 'utf8');
    const stored: {
      enabled: boolean;
      type: string;
      value: string;
      policy: string;
      noResolve: boolean;
    }[] = [];
    const app = buildApp(fakeApi(), {
      dataDir: dir,
      ruleProvider: 'custom',
      repo: {
        replaceAll: (inputs: (typeof stored)[number][]) => {
          stored.length = 0;
          stored.push(...inputs);
          return [];
        },
        list: () => stored.map((rule, index) => ({ id: index + 1, position: index + 1, ...rule })),
      },
      forceLoadUiConfig: async () => ({
        state: { file, config: DEFAULT_UI_CONFIG, updatedAt: null },
        rules: [
          { enabled: true, type: 'DOMAIN', value: 'b.com', policy: 'PROXY', noResolve: true },
        ],
        app: null,
      }),
      previewUiConfig: async () => ({
        file,
        config: DEFAULT_UI_CONFIG,
        diff: [],
        rules: null,
        app: null,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/load-force',
      payload: { file },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ rules: { count: number } }>().rules.count).toBe(1);
    expect(stored.map((rule) => rule.value)).toEqual(['b.com']);
    expect(readFileSync(path.join(dir, 'rules', 'custom.yaml'), 'utf8')).toContain(
      'DOMAIN,b.com,PROXY',
    );
    await app.close();
  });

  it('配置文件里带的设置段写回系统设置', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-load-settings-'));
    const file = path.join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(DEFAULT_UI_CONFIG), 'utf8');
    const saved: { core: { mixedPort: number }; subscription: { url: string } }[] = [];
    const app = buildApp(fakeApi(), {
      dataDir: dir,
      ruleProvider: 'custom',
      settings: {
        ...DEFAULT_SETTINGS,
        core: { ...DEFAULT_SETTINGS.core, binaryPath: process.execPath },
      },
      subscription: {
        url: '',
        useProxy: false,
        userAgent: '',
        lastOkAt: null,
        lastError: null,
        bytes: null,
        refreshing: false,
      },
      saveSettings: async (next: unknown) => {
        saved.push(next as { core: { mixedPort: number }; subscription: { url: string } });
        return next;
      },
      writeConfig: async () => undefined,
      kernel: { status: () => ({ state: 'stopped' }), setBinary: () => undefined },
      guard: { setServer: async () => undefined },
      repo: { replaceAll: () => [], list: () => [] },
      previewUiConfig: async () => ({
        file,
        config: DEFAULT_UI_CONFIG,
        diff: [],
        rules: null,
        app: { core: { mixedPort: 7899 }, subscription: { url: 'https://example.com/sub' } },
      }),
      forceLoadUiConfig: async () => ({
        state: { file, config: DEFAULT_UI_CONFIG, updatedAt: null },
        rules: null,
        app: null,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ui-config/load-force',
      payload: { file },
    });

    expect(response.statusCode).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.core.mixedPort).toBe(7899);
    expect(saved[0]?.subscription.url).toBe('https://example.com/sub');
    await app.close();
  });
});

describe.skipIf(!canLoadFastify)('离线兜底', () => {
  let buildApp: BuildApp;

  beforeAll(async () => {
    buildApp = await createBuilder();
  });

  const proxyState = {
    desired: { enable: false, server: '127.0.0.1:7890', override: '' },
    actual: null,
    match: false,
    guarding: false,
    supported: true,
    error: null,
  };

  it('GET /api/ping 返回 ok', async () => {
    const app = buildApp(fakeApi());
    const response = await app.inject({ method: 'GET', url: '/api/ping' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it('完全关闭代理：先停内核再关系统代理', async () => {
    const calls: string[] = [];
    const app = buildApp(fakeApi(), {
      kernel: {
        stop: async () => {
          calls.push('kernel.stop');
        },
        status: () => ({ state: 'stopped' }),
      },
      guard: {
        disable: async () => {
          calls.push('guard.disable');
          return proxyState;
        },
      },
    });
    const response = await app.inject({ method: 'POST', url: '/api/offline/shutdown' });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(['kernel.stop', 'guard.disable']);
    await app.close();
  });

  it('立即重启内核：重写配置 → 重启（代理由联动接管）', async () => {
    const calls: string[] = [];
    const app = buildApp(fakeApi(), {
      guard: {
        state: async () => proxyState,
      },
      writeConfig: async () => {
        calls.push('writeConfig');
      },
      restartKernel: async () => {
        calls.push('restartKernel');
        return { state: 'running' };
      },
    });
    const response = await app.inject({ method: 'POST', url: '/api/offline/restart' });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(['writeConfig', 'restartKernel']);
    await app.close();
  });
});
