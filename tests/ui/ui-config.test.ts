import fs, { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_CONFIG,
  ensureUiConfigFile,
  getRuleTypes,
  parseUiConfig,
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

describe('readUiConfigFile', () => {
  it('读合法 JSON', () => {
    const file = tempFile(JSON.stringify({ ...DEFAULT_UI_CONFIG, ruleTypes: ['DOMAIN'] }));
    expect(readUiConfigFile(file).ruleTypes).toEqual(['DOMAIN']);
  });

  it('文件缺失或内容非法都抛错', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-ui-config-'));
    expect(() => readUiConfigFile(uiConfigPath(dir))).toThrow('配置文件不存在或不可读');
    expect(() => readUiConfigFile(tempFile('{"ruleTypes": []}'))).toThrow();
    expect(() => readUiConfigFile(tempFile('不是 json'))).toThrow();
  });
});

describe('系统值', () => {
  it('setActiveUiConfig 立即影响规则类型白名单', () => {
    setActiveUiConfig({ ...DEFAULT_UI_CONFIG, ruleTypes: ['DOMAIN'] });
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

    expect(file).toBe(path.join(appDir, 'ui-config.json'));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(DEFAULT_UI_CONFIG);
  });

  it('已存在的文件不被覆盖', () => {
    const appDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-app-'));
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-data-'));
    const existing = { ...DEFAULT_UI_CONFIG, ruleTypes: ['DOMAIN'] };
    writeFileSync(path.join(appDir, 'ui-config.json'), JSON.stringify(existing), 'utf8');

    expect(readUiConfigFile(ensureUiConfigFile(appDir, dataDir)).ruleTypes).toEqual(['DOMAIN']);
  });

  it('app 目录不可写时退回 data 目录', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-data-'));
    const blocker = path.join(dataDir, 'blocker');
    writeFileSync(blocker, 'not a dir', 'utf8');

    const file = ensureUiConfigFile(blocker, dataDir);

    expect(file).toBe(uiConfigPath(dataDir));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(DEFAULT_UI_CONFIG);
  });
});
