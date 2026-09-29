import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAppConfig } from '../../src/app-config.js';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { DEFAULT_UI_CONFIG, getRuleTypes, uiConfigPath } from '../../src/ui-config.js';
import { createUiConfigService, diffUiConfig } from '../../src/ui-config-store.js';

function tempDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'mcp-ui-store-'));
}

describe('界面常量生效值（统一配置文件）', () => {
  it('文件不可用时用默认值，规则类型白名单立即就绪', () => {
    const dataDir = tempDataDir();

    const service = createUiConfigService(uiConfigPath(dataDir));

    expect(service.state().config).toEqual(DEFAULT_UI_CONFIG);
    expect(service.state().updatedAt).toBeNull();
    expect(getRuleTypes()).toEqual(DEFAULT_UI_CONFIG.ruleTypes);
  });

  it('已有配置文件按内容生效', () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(
      file,
      JSON.stringify({
        ...DEFAULT_UI_CONFIG,
        ruleTypes: ['DOMAIN'],
        defaults: { ...DEFAULT_UI_CONFIG.defaults, ruleType: 'DOMAIN' },
      }),
      'utf8',
    );

    const service = createUiConfigService(file);

    expect(service.state().config.ruleTypes).toEqual(['DOMAIN']);
    expect(service.state().updatedAt).not.toBeNull();
    expect(getRuleTypes()).toEqual(['DOMAIN']);
  });

  it('保存后重启仍读到文件里的值', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(file, JSON.stringify({ ...DEFAULT_UI_CONFIG, core: { mixedPort: 7899 } }), 'utf8');
    const service = createUiConfigService(file);
    await service.apply({
      config: { ...DEFAULT_UI_CONFIG, defaults: { ruleType: 'DOMAIN', policy: 'DIRECT' } },
    });

    // 新实例模拟重启：直接读文件
    const restarted = createUiConfigService(file);

    expect(restarted.state().config.defaults).toEqual({ ruleType: 'DOMAIN', policy: 'DIRECT' });
    // 保存界面常量不会碰同一文件里的应用设置段
    expect(readAppConfig(file).settings.core.mixedPort).toBe(7899);
  });

  it('diffUiConfig 标出不一致项', () => {
    const incoming = {
      ...DEFAULT_UI_CONFIG,
      ruleTypes: ['DOMAIN'],
      defaults: { ...DEFAULT_UI_CONFIG.defaults, ruleType: 'DOMAIN' },
    };
    const diff = diffUiConfig('/sys.json', DEFAULT_UI_CONFIG, '/sys.json', incoming);

    const types = diff.find((item) => item.label === '规则类型');
    expect(types?.same).toBe(false);
    expect(types?.current).toBe('DOMAIN-SUFFIX / DOMAIN');
    expect(types?.incoming).toBe('DOMAIN');
    // 规则类型与它的默认值一起变了
    expect(diff.filter((item) => !item.same).map((item) => item.label)).toEqual([
      '规则类型',
      '默认规则类型',
    ]);
  });

  it('严格路径：forceLoad / apply 都要求 .json 且文件存在', async () => {
    const dataDir = tempDataDir();
    const service = createUiConfigService(uiConfigPath(dataDir));

    await expect(service.forceLoad('not-json')).rejects.toThrow('必须以 .json 结尾');
    expect(() => service.preview(path.join(dataDir, 'missing.json'))).toThrow('不存在或不可读');
    await expect(service.apply({ file: 'aaa', config: DEFAULT_UI_CONFIG })).rejects.toThrow(
      '必须以 .json 结尾',
    );

    // 合法路径：写入统一配置文件
    const file = uiConfigPath(dataDir);
    writeFileSync(file, JSON.stringify(DEFAULT_UI_CONFIG), 'utf8');
    const applied = await service.apply({ config: DEFAULT_UI_CONFIG });
    expect(applied.state.file).toBe(file);
    // 界面提交的只有界面常量，规则不动
    expect(applied.rules).toBeNull();
  });

  it('配置文件里的 rules 段随加载一起返回，预览 diff 标出规则条数', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    const service = createUiConfigService(file);
    writeFileSync(
      file,
      JSON.stringify({
        ...DEFAULT_UI_CONFIG,
        rules: [{ type: 'DOMAIN-SUFFIX', value: 'a.com', policy: 'PROXY' }],
      }),
      'utf8',
    );

    const loaded = await service.forceLoad();
    expect(loaded.rules).toHaveLength(1);
    expect(loaded.rules?.[0]?.value).toBe('a.com');

    const preview = service.preview();
    expect(preview.rules).toHaveLength(1);
    expect(preview.diff.map((item) => item.label)).toContain('自定义规则（条）');
  });

  it('从外部文件加载时，内容同步写回统一配置文件', async () => {
    const dataDir = tempDataDir();
    const file = uiConfigPath(dataDir);
    writeFileSync(file, JSON.stringify(DEFAULT_UI_CONFIG), 'utf8');
    const service = createUiConfigService(file);
    const external = path.join(dataDir, 'mine.json');
    writeFileSync(
      external,
      JSON.stringify({
        ...DEFAULT_UI_CONFIG,
        ruleTypes: ['DOMAIN'],
        defaults: { ...DEFAULT_UI_CONFIG.defaults, ruleType: 'DOMAIN' },
        core: { mixedPort: 7899 },
      }),
      'utf8',
    );

    const loaded = await service.forceLoad(external);

    expect(loaded.state.file).toBe(external);
    // 界面常量落回统一文件；应用设置段由 /api/settings 那条路管，加载界面常量不碰它
    const unified = JSON.parse(readFileSync(file, 'utf8')) as {
      ruleTypes: string[];
      core?: { mixedPort?: number };
    };
    expect(unified.ruleTypes).toEqual(['DOMAIN']);
    expect(unified.core?.mixedPort).toBe(DEFAULT_SETTINGS.core.mixedPort);
  });
});
