import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_CONFIG,
  getRuleTypes,
  parseUiConfig,
  parseUiConfigFile,
  readUiConfigDocument,
  readUiConfigFile,
  setActiveUiConfig,
  uiConfigPath,
} from '../../src/ui-config.js';

function tempFile(text: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-ui-config-'));
  const file = path.join(dir, 'ui-config.json');
  writeFileSync(file, text, 'utf8');
  return file;
}

/** 合法的最小变体：改规则类型时默认值要跟着改，否则跨字段检测会拦下。 */
function withRuleTypes(ruleTypes: string[]): typeof DEFAULT_UI_CONFIG {
  return {
    ...DEFAULT_UI_CONFIG,
    ruleTypes,
    defaults: { ...DEFAULT_UI_CONFIG.defaults, ruleType: ruleTypes[0] ?? 'DOMAIN' },
  };
}

describe('readUiConfigFile', () => {
  it('读合法 JSON', () => {
    const file = tempFile(JSON.stringify(withRuleTypes(['DOMAIN'])));
    expect(readUiConfigFile(file).ruleTypes).toEqual(['DOMAIN']);
  });

  it('文件缺失或内容非法都抛错', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-ui-config-'));
    expect(() => readUiConfigFile(uiConfigPath(dir))).toThrow('配置文件不存在或不可读');
    expect(() => readUiConfigFile(tempFile('   '))).toThrow('配置文件是空文件');
    expect(() => readUiConfigFile(tempFile('不是 json'))).toThrow('配置文件不是合法 JSON');
    expect(() => readUiConfigFile(tempFile('{"ruleTypes": []}'))).toThrow('配置文件字段不合法');
  });
});

describe('config.json 里的规则', () => {
  const rule = { type: 'DOMAIN', value: 'chatgpt.com', policy: 'PROXY' };

  it('解析出规则，缺省字段按默认值补齐', () => {
    const file = tempFile(JSON.stringify({ ...withRuleTypes(['DOMAIN']), rules: [rule] }));
    const parsed = readUiConfigDocument(file);

    expect(parsed.config.ruleTypes).toEqual(['DOMAIN']);
    expect(parsed.rules).toEqual([
      { enabled: true, type: 'DOMAIN', value: 'chatgpt.com', policy: 'PROXY', noResolve: true },
    ]);
  });

  it('没有 rules 段时 rules 为 null（加载时不碰库里的规则）', () => {
    const file = tempFile(JSON.stringify(withRuleTypes(['DOMAIN'])));
    expect(readUiConfigDocument(file).rules).toBeNull();
  });

  it('规则类型必须在 ruleTypes 白名单里，值不能为空', () => {
    const bad = tempFile(
      JSON.stringify({
        ...withRuleTypes(['DOMAIN']),
        rules: [{ type: 'IP-CIDR', value: '', policy: 'PROXY' }],
      }),
    );
    expect(() => readUiConfigDocument(bad)).toThrow('配置文件字段不合法');
    expect(() => readUiConfigDocument(bad)).toThrow('不在规则类型列表里：IP-CIDR');
  });

  it('设置段（内核/订阅/系统代理）能与界面常量、规则一起解析回来', () => {
    const json = JSON.stringify({
      ...withRuleTypes(['DOMAIN']),
      rules: [],
      core: { binaryPath: 'C:/x/mihomo.exe', mixedPort: 7891 },
      subscription: {
        url: 'https://example.com/sub',
        useProxy: true,
        userAgent: 'ua',
        proxyGroup: 'Proxy',
      },
      proxy: { override: 'localhost;127.*' },
    });
    const parsed = parseUiConfigFile(JSON.parse(json));

    expect(parsed.app?.core).toEqual({ binaryPath: 'C:/x/mihomo.exe', mixedPort: 7891 });
    expect(parsed.app?.subscription?.url).toBe('https://example.com/sub');
    expect(parsed.app?.subscription?.proxyGroup).toBe('Proxy');
    expect(parsed.app?.proxy?.override).toBe('localhost;127.*');
  });

  it('没有设置段时 app 为 null，端口越界会被拦下', () => {
    expect(parseUiConfigFile(withRuleTypes(['DOMAIN'])).app).toBeNull();
    expect(() =>
      parseUiConfigFile({ ...withRuleTypes(['DOMAIN']), core: { mixedPort: 70000 } }),
    ).toThrow('core.mixedPort');
  });
});

describe('系统值', () => {
  it('setActiveUiConfig 立即影响规则类型白名单', () => {
    setActiveUiConfig(withRuleTypes(['DOMAIN']));
    expect(getRuleTypes()).toEqual(['DOMAIN']);
    setActiveUiConfig(DEFAULT_UI_CONFIG);
    expect(getRuleTypes()).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
  });

  it('parseUiConfig 会拒绝缺字段的对象', () => {
    expect(() => parseUiConfig({ ruleTypes: ['DOMAIN'] })).toThrow();
  });
});
