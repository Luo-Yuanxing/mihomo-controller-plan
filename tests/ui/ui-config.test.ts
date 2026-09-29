import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_CONFIG,
  getRuleTypes,
  loadUiConfig,
  uiConfigPath,
} from '../../src/ui-config.js';

function tempDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'mcp-ui-config-'));
}

describe('loadUiConfig', () => {
  beforeEach(async () => {
    // 每个用例前把全局生效值复位，避免用例间互相影响
    await loadUiConfig(tempDataDir());
  });

  it('文件缺失时写入默认值并返回 default', async () => {
    const dataDir = tempDataDir();
    const state = await loadUiConfig(dataDir);

    expect(state.source).toBe('default');
    expect(state.error).toBeNull();
    expect(state.config).toEqual(DEFAULT_UI_CONFIG);
    expect(JSON.parse(readFileSync(uiConfigPath(dataDir), 'utf8'))).toEqual(DEFAULT_UI_CONFIG);
    expect(getRuleTypes()).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
  });

  it('合法文件立即生效', async () => {
    const dataDir = tempDataDir();
    const custom = {
      ...DEFAULT_UI_CONFIG,
      ruleTypes: ['DOMAIN', 'DOMAIN-KEYWORD'],
      defaults: { ruleType: 'DOMAIN', policy: 'DIRECT' },
    };
    writeFileSync(uiConfigPath(dataDir), JSON.stringify(custom), 'utf8');

    const state = await loadUiConfig(dataDir);

    expect(state.source).toBe('file');
    expect(getRuleTypes()).toEqual(['DOMAIN', 'DOMAIN-KEYWORD']);
  });

  it('非法文件回退默认值并带错误信息', async () => {
    const dataDir = tempDataDir();
    writeFileSync(uiConfigPath(dataDir), '{"ruleTypes": []}', 'utf8');

    const state = await loadUiConfig(dataDir);

    expect(state.source).toBe('default');
    expect(state.error).not.toBeNull();
    expect(getRuleTypes()).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
  });
});
