import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAppConfig } from '../../src/app-config.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { DEFAULT_UI_CONFIG, getRuleTypes, uiConfigPath } from '../../src/ui-config.js';
import { decodeSharedConfig, encodeSharedConfig } from '../../src/ui-config-share.js';
import { createUiConfigService } from '../../src/ui-config-store.js';

function tempDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'mcp-ui-store-'));
}

/** 合法的最小变体：改规则类型时默认值要跟着改，否则跨字段检测会拦下。 */
function withRuleTypes(ruleTypes: string[]): typeof DEFAULT_UI_CONFIG {
  return {
    ...DEFAULT_UI_CONFIG,
    ruleTypes,
    defaults: { ...DEFAULT_UI_CONFIG.defaults, ruleType: ruleTypes[0] ?? 'DOMAIN' },
  };
}

describe('导入设置的生效值', () => {
  /** 加载时的初始化落盘是异步的：轮询到条件成立为止。 */
  async function waitUntil(check: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('等待初始化标记落盘超时');
  }

  it('文件不可用时用默认值，初始化标记落成 false', async () => {
    const dataDir = tempDataDir();

    const service = createUiConfigService(uiConfigPath(dataDir));

    expect(service.state().config).toEqual(DEFAULT_UI_CONFIG);
    expect(service.state().initialized).toBe(false);
    expect(getRuleTypes()).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
    await waitUntil(() => readAppConfig(uiConfigPath(dataDir)).initialized === false);
  });

  it('旧文件里 initialized 为 true 时，加载即落成 false', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(
      file,
      JSON.stringify({ ...withRuleTypes(['DOMAIN']), initialized: true }),
      'utf8',
    );

    const service = createUiConfigService(file);

    expect(service.state().config.ruleTypes).toEqual(['DOMAIN']);
    expect(service.state().initialized).toBe(false);
    expect(getRuleTypes()).toEqual(['DOMAIN']);
    await waitUntil(() => readAppConfig(file).initialized === false);
  });

  it('保存界面常量后重启仍读到，且文件里的应用设置段不受影响', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(
      file,
      JSON.stringify({ ...DEFAULT_UI_CONFIG, core: { mixedPort: 7899 }, initialized: true }),
      'utf8',
    );
    const service = createUiConfigService(file);

    const saved = await service.apply(withRuleTypes(['DOMAIN']));

    expect(saved.initialized).toBe(false);
    expect(readAppConfig(file).settings.core.mixedPort).toBe(7899);
    expect(createUiConfigService(file).state().config.ruleTypes).toEqual(['DOMAIN']);
  });

  it('立即初始化：只把标记落成 false，内容与内存生效值都不动', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(file, JSON.stringify({ ...withRuleTypes(['DOMAIN']), initialized: true }), 'utf8');
    const service = createUiConfigService(file);

    const state = await service.initialize();

    expect(state.initialized).toBe(false);
    expect(readAppConfig(file).initialized).toBe(false);
    expect(readAppConfig(file).ui.ruleTypes).toEqual(['DOMAIN']);
    expect(getRuleTypes()).toEqual(['DOMAIN']);
  });

  it('导入分享串：界面常量与规则段落盘、标记改成已初始化', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(file, JSON.stringify({ ...DEFAULT_UI_CONFIG, initialized: true }), 'utf8');
    const service = createUiConfigService(file);
    const payload = encodeSharedConfig({
      config: withRuleTypes(['DOMAIN']),
      rules: [{ enabled: true, type: 'DOMAIN', value: 'a.com', policy: 'PROXY', noResolve: true }],
      app: { proxy: { enabled: true, override: 'localhost;127.*' } },
    });

    const result = await service.importShared(payload);

    expect(result.state.initialized).toBe(false);
    expect(result.rules).toHaveLength(1);
    expect(result.app?.proxy?.enabled).toBe(true);
    const written = readAppConfig(file);
    expect(written.ui.ruleTypes).toEqual(['DOMAIN']);
    expect(written.rules).toHaveLength(1);
    expect(written.initialized).toBe(false);
    expect(getRuleTypes()).toEqual(['DOMAIN']);
  });

  it('导入串字段不合法时抛错，文件一个字节都不动', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    // 不含初始化标记：加载时不会落盘改写文件，才谈得上"一个字节都不动"
    const original = JSON.stringify(DEFAULT_UI_CONFIG);
    writeFileSync(file, original, 'utf8');
    const service = createUiConfigService(file);
    await waitUntil(() => readFileSync(file, 'utf8') === original);

    await expect(service.importShared('这不是base64!!')).rejects.toThrow('不是合法的 Base64URL 字符串');
    await expect(
      service.importShared(Buffer.from('{"ruleTypes": []}', 'utf8').toString('base64url')),
    ).rejects.toThrow('ruleTypes');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('生成的分享串能被自己解析回来', () => {
    const service = createUiConfigService(uiConfigPath(tempDataDir()));
    const payload = service.share([], {
      core: { binaryPath: 'resources/bin/mihomo.exe', mixedPort: 7890 },
      proxy: { enabled: false, override: DEFAULT_SETTINGS.proxy.override },
    });

    const shared = decodeSharedConfig(payload);
    expect(shared.config).toEqual(DEFAULT_UI_CONFIG);
    expect(shared.app?.core?.mixedPort).toBe(7890);
    expect(shared.app?.subscription).toBeUndefined();
  });
});
