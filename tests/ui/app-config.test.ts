import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_CONFIG,
  ensureAppConfigFile,
  readAppConfig,
  renderAppConfig,
} from '../../src/app-config.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { DEFAULT_UI_CONFIG } from '../../src/ui-config.js';

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 合法的最小变体：改规则类型时默认值要跟着改，否则跨字段检测会拦下。 */
function withRuleTypes(ruleTypes: string[]): typeof DEFAULT_UI_CONFIG {
  return {
    ...DEFAULT_UI_CONFIG,
    ruleTypes,
    defaults: { ...DEFAULT_UI_CONFIG.defaults, ruleType: ruleTypes[0] ?? 'DOMAIN' },
  };
}

describe('ensureAppConfigFile', () => {
  it('在工作目录预生成配置文件（界面常量 + 应用设置 + 空规则）', () => {
    const appDir = tempDir('mcp-app-');
    const dataDir = tempDir('mcp-data-');

    const file = ensureAppConfigFile(appDir, dataDir);

    expect(file).toBe(path.join(appDir, 'config.json'));
    const config = readAppConfig(file);
    expect(config.ui).toEqual(DEFAULT_UI_CONFIG);
    expect(config.settings).toEqual(DEFAULT_SETTINGS);
    expect(config.rules).toEqual([]);
    // 预生成的就是已初始化：启动直接按文件生效，不加载引导
    expect(config.initialized).toBe(false);
  });

  it('已存在的文件不被覆盖', () => {
    const appDir = tempDir('mcp-app-');
    const dataDir = tempDir('mcp-data-');
    const file = path.join(appDir, 'config.json');
    writeFileSync(
      file,
      JSON.stringify({ ...withRuleTypes(['DOMAIN']), core: { mixedPort: 7899 }, initialized: false }),
    );

    const ensured = ensureAppConfigFile(appDir, dataDir);

    expect(readAppConfig(ensured).ui.ruleTypes).toEqual(['DOMAIN']);
    expect(readAppConfig(file).settings.core.mixedPort).toBe(7899);
    expect(readAppConfig(file).initialized).toBe(false);
  });

  it('工作目录不可写时退回 data 目录', () => {
    const dataDir = tempDir('mcp-data-');
    const blocker = path.join(dataDir, 'blocker');
    writeFileSync(blocker, 'not a dir', 'utf8');

    const file = ensureAppConfigFile(blocker, dataDir);

    expect(file).toBe(path.join(dataDir, 'config.json'));
    expect(readAppConfig(file).ui).toEqual(DEFAULT_UI_CONFIG);
  });
});

describe('readAppConfig', () => {
  it('缺段按默认值补齐', () => {
    const dir = tempDir('mcp-app-');
    const file = path.join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ ...withRuleTypes(['DOMAIN']), core: { mixedPort: 7899 } }));

    const config = readAppConfig(file);
    expect(config.ui.ruleTypes).toEqual(['DOMAIN']);
    expect(config.settings.core.mixedPort).toBe(7899);
    expect(config.settings.core.binaryPath).toBe(DEFAULT_SETTINGS.core.binaryPath);
    expect(config.settings.subscription).toEqual(DEFAULT_SETTINGS.subscription);
    expect(config.rules).toBeNull();
  });

  it('文件缺失或不是 JSON 时退回默认值', () => {
    const dir = tempDir('mcp-app-');
    expect(readAppConfig(path.join(dir, 'missing.json'))).toEqual(DEFAULT_APP_CONFIG);

    const broken = path.join(dir, 'config.json');
    writeFileSync(broken, '不是 json');
    expect(readAppConfig(broken)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('老文件没有初始化标记时按"已初始化"处理，启动不加载引导', () => {
    const dir = tempDir('mcp-app-');
    const file = path.join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(withRuleTypes(['DOMAIN'])));

    expect(readAppConfig(file).initialized).toBe(false);
  });

  it('初始化标记为 true 时原样读出来', () => {
    const dir = tempDir('mcp-app-');
    const file = path.join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ ...withRuleTypes(['DOMAIN']), initialized: true }));

    expect(readAppConfig(file).initialized).toBe(true);
  });
});

describe('renderAppConfig', () => {
  it('三段平铺一层，能被 readAppConfig 原样读回', () => {
    const text = renderAppConfig({
      ui: withRuleTypes(['DOMAIN']),
      settings: { ...DEFAULT_SETTINGS, core: { ...DEFAULT_SETTINGS.core, secret: 'abc' } },
      rules: [{ enabled: true, type: 'DOMAIN', value: 'a.com', policy: 'PROXY', noResolve: true }],
      initialized: false,
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(parsed)).toContain('ruleTypes');
    expect(Object.keys(parsed)).toContain('core');
    expect(Object.keys(parsed)).toContain('rules');
    expect(parsed['initialized']).toBe(false);
  });
});

describe('旧 data/settings.json 迁移', () => {
  it('并入统一配置文件后把旧文件改名保留', () => {
    const appDir = tempDir('mcp-app-');
    const dataDir = tempDir('mcp-data-');
    const legacy = path.join(dataDir, 'settings.json');
    writeFileSync(
      legacy,
      JSON.stringify({
        core: { binaryPath: 'resources/bin/mihomo.exe', mixedPort: 7899, secret: 'abc' },
        subscription: { url: 'https://example.com/sub' },
        proxy: { enabled: true },
      }),
    );

    const file = ensureAppConfigFile(appDir, dataDir);
    const config = readAppConfig(file);

    expect(config.settings.core.mixedPort).toBe(7899);
    expect(config.settings.core.secret).toBe('abc');
    expect(config.settings.subscription.url).toBe('https://example.com/sub');
    expect(config.settings.subscription.userAgent).toBe(DEFAULT_SETTINGS.subscription.userAgent);
    expect(config.settings.proxy.enabled).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(`${legacy}.migrated`)).toBe(true);
  });
});
