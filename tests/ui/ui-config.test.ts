import fs, { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_CONFIG,
  DEFAULT_UI_CONFIG_FILE,
  ensureUiConfigFile,
  getRuleTypes,
  parseUiConfig,
  parseUiConfigFile,
  renderUiConfigFile,
  readUiConfigDocument,
  readUiConfigFile,
  resolveExportTarget,
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

  it('导出内容含界面常量与规则，能被自己解析回来', () => {
    const json = renderUiConfigFile(withRuleTypes(['DOMAIN']), [
      { enabled: false, type: 'DOMAIN', value: 'a.com', policy: 'DIRECT', noResolve: false },
    ]);
    const parsed = parseUiConfigFile(JSON.parse(json));

    expect(parsed.config.ruleTypes).toEqual(['DOMAIN']);
    expect(parsed.rules).toEqual([
      { enabled: false, type: 'DOMAIN', value: 'a.com', policy: 'DIRECT', noResolve: false },
    ]);
  });

  it('导出目标允许文件不存在，但必须 .json', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-export-'));
    const target = resolveExportTarget(path.join(dir, '备份.json'));
    expect(target).toBe(path.join(dir, '备份.json'));
    expect(() => resolveExportTarget('  ')).toThrow('导出路径不能为空');
    expect(() => resolveExportTarget(path.join(dir, '备份.yaml'))).toThrow('必须以 .json 结尾');
  });

  it('设置段（内核/订阅/系统代理）能与界面常量、规则一起导出并解析回来', () => {
    const json = renderUiConfigFile(withRuleTypes(['DOMAIN']), [], {
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

describe('ensureUiConfigFile', () => {
  it('在 app 启动路径预生成默认配置文件', () => {
    const appDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-app-'));
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-data-'));

    const file = ensureUiConfigFile(appDir, dataDir);

    expect(file).toBe(path.join(appDir, 'config.json'));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(DEFAULT_UI_CONFIG_FILE);
  });

  it('已存在的文件不被覆盖', () => {
    const appDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-app-'));
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-data-'));
    const existing = withRuleTypes(['DOMAIN']);
    writeFileSync(path.join(appDir, 'config.json'), JSON.stringify(existing), 'utf8');

    expect(readUiConfigFile(ensureUiConfigFile(appDir, dataDir)).ruleTypes).toEqual(['DOMAIN']);
  });

  it('app 目录不可写时退回 data 目录', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-data-'));
    const blocker = path.join(dataDir, 'blocker');
    writeFileSync(blocker, 'not a dir', 'utf8');

    const file = ensureUiConfigFile(blocker, dataDir);

    expect(file).toBe(uiConfigPath(dataDir));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(DEFAULT_UI_CONFIG_FILE);
  });
});
