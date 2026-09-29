import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import { readAppConfig } from '../../src/app-config.js';
import type { AppContext } from '../../src/context.js';
import { createConnectionTracker } from '../../src/logs/connection-sampler.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { getUiConfig, uiConfigPath } from '../../src/ui-config.js';
import { createUiConfigService } from '../../src/ui-config-store.js';
import { dataPaths } from '../../src/util/paths.js';
import { logPaths } from '../../src/util/logger.js';

// 与 routes/ui-config.test.ts 同一门槛：fastify v5 需要 Node >= 20。
const canLoadFastify = Number(process.versions.node.split('.')[0] ?? 0) >= 20;

/** 两条 dial 失败：一条落在黑名单里，一条不该被筛掉。 */
const CORE_LOG = [
  `time="${new Date().toISOString()}" level=warning msg="[TCP] dial PROXY (match Match/) 127.0.0.1:59269 --> blocked.example.com:443 error: connect failed: dial tcp 1.1.1.1:443: i/o timeout"`,
  `time="${new Date().toISOString()}" level=warning msg="[TCP] dial PROXY (match Match/) 127.0.0.1:59270 --> keep.example.net:443 error: connect failed: dial tcp 2.2.2.2:443: i/o timeout"`,
].join('\n');

async function createBuilder(): Promise<(dataDir: string) => FastifyInstance> {
  const [{ default: Fastify }, { registerRoutes }] = await Promise.all([
    import('fastify'),
    import('../../src/routes.js'),
  ]);

  return (dataDir: string): FastifyInstance => {
    const file = uiConfigPath(dataDir);
    const uiConfigService = createUiConfigService(file);
    const context = {
      appVersion: 'test',
      appDir: dataDir,
      dataDir,
      dataFallback: false,
      paths: dataPaths(dataDir),
      log: pino({ level: 'silent' }),
      settings: DEFAULT_SETTINGS,
      repo: { list: () => [] },
      // 采样源走空快照：这个测试只看日志来源与黑名单筛选
      api: { connections: async () => [] },
      failureTracker: createConnectionTracker(),
      get uiConfig() {
        return getUiConfig();
      },
      uiConfigState: () => uiConfigService.state(),
      saveBlacklist: async (hosts: string[]) => uiConfigService.saveBlacklist(hosts),
    } as unknown as AppContext;

    const app = Fastify();
    registerRoutes(app, context);
    return app;
  };
}

function tempDataDir(blacklistHosts: string[] = []): string {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mihomo-blacklist-'));
  writeFileSync(
    uiConfigPath(dataDir),
    JSON.stringify({
      ...readAppConfig(uiConfigPath(dataDir)).ui,
      blacklist: { enabled: true, hosts: blacklistHosts },
    }),
  );
  const coreLog = logPaths(dataDir).core;
  mkdirSync(path.dirname(coreLog), { recursive: true });
  writeFileSync(coreLog, CORE_LOG);
  return dataDir;
}

describe.skipIf(!canLoadFastify)('/api/failed-connections 黑名单筛选', () => {
  let build: (dataDir: string) => FastifyInstance;

  beforeAll(async () => {
    build = await createBuilder();
  });

  it('黑名单里的目标不进列表，命中条数单独回给界面', async () => {
    const app = build(tempDataDir(['blocked.example.com']));
    const body = (
      await app.inject({ method: 'GET', url: '/api/failed-connections?lines=100' })
    ).json();

    expect(body.connections.map((item: { host: string }) => item.host)).toEqual([
      'keep.example.net',
    ]);
    expect(body.blacklist.hiddenCount).toBe(1);
    expect(body.blacklist.matched).toEqual([
      { host: 'blocked.example.com', port: 443, network: 'TCP' },
    ]);
    await app.close();
  });

  it('skip=1 关掉筛选：被拉黑的目标照样出现', async () => {
    const app = build(tempDataDir(['blocked.example.com']));
    const body = (
      await app.inject({ method: 'GET', url: '/api/failed-connections?lines=100&skip=1' })
    ).json();

    expect(body.connections.map((item: { host: string }) => item.host)).toEqual([
      'blocked.example.com',
      'keep.example.net',
    ]);
    expect(body.blacklist.hiddenCount).toBe(0);
    await app.close();
  });
});

describe.skipIf(!canLoadFastify)('PUT /api/blacklist', () => {
  let build: (dataDir: string) => FastifyInstance;

  beforeAll(async () => {
    build = await createBuilder();
  });

  it('多选一次加入：去重落 config.json，重复的算跳过', async () => {
    const dataDir = tempDataDir(['blocked.example.com']);
    const app = build(dataDir);
    const body = (
      await app.inject({
        method: 'PUT',
        url: '/api/blacklist',
        payload: { add: ['Blocked.example.com', '*.example.org', '*.example.org'] },
      })
    ).json();

    expect(body.added).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.hosts).toEqual(['blocked.example.com', '*.example.org']);
    expect(readAppConfig(uiConfigPath(dataDir)).ui.blacklist.hosts).toEqual([
      'blocked.example.com',
      '*.example.org',
    ]);
    await app.close();
  });

  it('移出黑名单：不在名单里的只计数', async () => {
    const app = build(tempDataDir(['a.example.com']));
    const body = (
      await app.inject({
        method: 'PUT',
        url: '/api/blacklist',
        payload: { remove: ['a.example.com', 'b.example.com'] },
      })
    ).json();

    expect(body.removed).toBe(1);
    expect(body.missing).toBe(1);
    expect(body.hosts).toEqual([]);
    await app.close();
  });

  it('主机写法不合法整批拒绝，文件不动', async () => {
    const dataDir = tempDataDir(['a.example.com']);
    const app = build(dataDir);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/blacklist',
      payload: { add: ['ok.example.com', 'bad*host'] },
    });

    expect(response.statusCode).toBe(400);
    expect(readAppConfig(uiConfigPath(dataDir)).ui.blacklist.hosts).toEqual(['a.example.com']);
    await app.close();
  });

  it('什么都不给直接 400', async () => {
    const app = build(tempDataDir());
    const response = await app.inject({ method: 'PUT', url: '/api/blacklist', payload: {} });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('GET 只读返回当前名单与开关默认位置', async () => {
    const app = build(tempDataDir(['*.example.com']));
    const body = (await app.inject({ method: 'GET', url: '/api/blacklist' })).json();
    expect(body).toEqual({ enabled: true, hosts: ['*.example.com'] });
    await app.close();
  });
});

it('配置文件里的黑名单非法时退回默认值，不挡启动', () => {
  const dataDir = tempDataDir();
  writeFileSync(
    uiConfigPath(dataDir),
    JSON.stringify({ ...readAppConfig(uiConfigPath(dataDir)).ui, blacklist: { hosts: 'nope' } }),
  );
  expect(readAppConfig(uiConfigPath(dataDir)).ui.blacklist).toEqual({
    enabled: true,
    hosts: [],
  });
  expect(readFileSync(uiConfigPath(dataDir), 'utf8')).toContain('nope');
});
