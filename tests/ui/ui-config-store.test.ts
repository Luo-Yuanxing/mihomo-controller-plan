import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRulesDatabase, type RulesDatabase } from '../../src/rules/db.js';
import { DEFAULT_UI_CONFIG, getRuleTypes, uiConfigPath } from '../../src/ui-config.js';
import {
  diffUiConfig,
  loadStoredUiConfig,
  readSetting,
  saveStoredUiConfig,
  UI_CONFIG_KEY,
} from '../../src/ui-config-store.js';

// better-sqlite3 的原生绑定在低版本 Node 的 vitest 环境里解析不到（项目本身要求 Node >= 22），
// 用 Electron 内置 Node 跑测试时会正常执行。
const canLoadSqlite = Number(process.versions.node.split('.')[0] ?? 0) >= 20;

const databases: RulesDatabase[] = [];

function tempDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'mcp-ui-store-'));
}

function open(dataDir: string): RulesDatabase {
  const db = openRulesDatabase(dataDir);
  databases.push(db);
  return db;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe.skipIf(!canLoadSqlite)('界面常量持久化', () => {
  it('首次启动：文件不可用时用默认值建库记录', () => {
    const dataDir = tempDataDir();
    const db = open(dataDir);

    const state = loadStoredUiConfig(db, uiConfigPath(dataDir));

    expect(state.config).toEqual(DEFAULT_UI_CONFIG);
    expect(state.updatedAt).not.toBeNull();
    expect(readSetting(db, UI_CONFIG_KEY)).not.toBeNull();
    expect(getRuleTypes()).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
  });

  it('首次启动：用现有配置文件初始化系统值', () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(file, JSON.stringify({ ...DEFAULT_UI_CONFIG, ruleTypes: ['DOMAIN'] }), 'utf8');
    const db = open(dataDir);

    const state = loadStoredUiConfig(db, file);

    expect(state.config.ruleTypes).toEqual(['DOMAIN']);
    expect(getRuleTypes()).toEqual(['DOMAIN']);
  });

  it('保存后重启（新连接）仍读到系统值，与文件无关', () => {
    const dataDir = tempDataDir();
    const db = open(dataDir);
    loadStoredUiConfig(db, uiConfigPath(dataDir));
    const custom = { ...DEFAULT_UI_CONFIG, defaults: { ruleType: 'DOMAIN', policy: 'DIRECT' } };
    saveStoredUiConfig(db, 'D:/anywhere/mine.json', custom);

    // 新连接模拟重启：文件仍是不存在的默认路径，但系统值应保持
    const reopened = open(dataDir);
    const state = loadStoredUiConfig(reopened, uiConfigPath(dataDir));

    expect(state.file).toBe('D:/anywhere/mine.json');
    expect(state.config.defaults).toEqual({ ruleType: 'DOMAIN', policy: 'DIRECT' });
  });

  it('diffUiConfig 标出不一致项', () => {
    const incoming = { ...DEFAULT_UI_CONFIG, ruleTypes: ['DOMAIN'] };
    const diff = diffUiConfig('/sys.json', DEFAULT_UI_CONFIG, '/sys.json', incoming);

    const types = diff.find((item) => item.label === '规则类型');
    expect(types?.same).toBe(false);
    expect(types?.current).toBe('DOMAIN-SUFFIX / DOMAIN');
    expect(types?.incoming).toBe('DOMAIN');
    expect(diff.filter((item) => !item.same)).toHaveLength(1);
  });
});
