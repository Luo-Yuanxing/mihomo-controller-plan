import { mkdtempSync, writeFileSync } from 'node:fs';
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

function fakeApi(): FakeApi {
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
      uiDir: '',
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
