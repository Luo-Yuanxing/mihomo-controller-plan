import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_CONFIG,
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
