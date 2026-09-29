/**
 * 工作目录下的单一配置文件 config.json：界面常量 + 应用设置（内核/订阅/系统代理）+ 可选规则段。
 * 文件是唯一真相源：不再有独立的 data/settings.json，也不再往 SQLite 存副本。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from './settings.js';
import {
  appSettingsFileSchema,
  DEFAULT_UI_CONFIG,
  ruleEntrySchema,
  uiConfigSchema,
  type AppSettingsFile,
  type RuleEntry,
  type UiConfig,
} from './ui-config.js';
import { writeFileAtomic } from './util/atomic.js';

/** 统一配置文件：三段合一。 */
export const appConfigSchema = uiConfigSchema.extend({
  ...settingsSchema.shape,
  rules: z.array(ruleEntrySchema).optional(),
});

export interface AppConfig {
  ui: UiConfig;
  settings: Settings;
  /** 规则段只在导入/导出时同步，null = 文件没带这一段。 */
  rules: RuleEntry[] | null;
  /** 界面里"配置文件路径"那一栏的持久值（绝对路径）；null = 就用统一配置文件自己。 */
  configFile: string | null;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  ui: DEFAULT_UI_CONFIG,
  settings: DEFAULT_SETTINGS,
  rules: [],
  configFile: null,
};

/** 文件正文：界面常量与设置平铺在同一层，规则段与配置文件路径可选。 */
export function renderAppConfig(config: AppConfig): string {
  const { ui, settings, rules, configFile } = config;
  return `${JSON.stringify(
    { ...ui, ...settings, ...(rules === null ? {} : { rules }), ...(configFile === null ? {} : { configFile }) },
    null,
    2,
  )}\n`;
}

/**
 * 宽容读取：文件缺失/不是 JSON/界面常量非法都退回默认值，
 * 免得手改坏的文件把启动挡死（严格校验只用在用户主动导入的文件上）。
 */
export function readAppConfig(file: string): AppConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return DEFAULT_APP_CONFIG;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_APP_CONFIG;
  const record = raw as Record<string, unknown>;

  const ui = uiConfigSchema.safeParse(record);
  const app = appSettingsFileSchema.safeParse({
    core: record['core'],
    subscription: record['subscription'],
    proxy: record['proxy'],
  });
  const rules = z.array(ruleEntrySchema).safeParse(record['rules']);
  const configFile = record['configFile'];
  const configFileText =
    typeof configFile === 'string' && configFile.trim() !== '' ? path.resolve(configFile.trim()) : null;

  return {
    ui: ui.success ? ui.data : DEFAULT_UI_CONFIG,
    settings: mergeSettings(app.data),
    rules: rules.success ? rules.data : null,
    configFile: configFileText,
  };
}

/** 逐字段补默认值：文件里只写了一半也照样读得回来。 */
function mergeSettings(raw: AppSettingsFile | undefined): Settings {
  const core = raw?.core;
  const subscription = raw?.subscription;
  const proxy = raw?.proxy;
  return {
    core: {
      binaryPath: core?.binaryPath ?? DEFAULT_SETTINGS.core.binaryPath,
      mixedPort: core?.mixedPort ?? DEFAULT_SETTINGS.core.mixedPort,
      secret: core?.secret ?? DEFAULT_SETTINGS.core.secret,
    },
    subscription: {
      url: subscription?.url ?? DEFAULT_SETTINGS.subscription.url,
      useProxy: subscription?.useProxy ?? DEFAULT_SETTINGS.subscription.useProxy,
      userAgent: subscription?.userAgent ?? DEFAULT_SETTINGS.subscription.userAgent,
      proxyGroup: subscription?.proxyGroup ?? DEFAULT_SETTINGS.subscription.proxyGroup,
    },
    proxy: {
      enabled: proxy?.enabled ?? DEFAULT_SETTINGS.proxy.enabled,
      override: proxy?.override ?? DEFAULT_SETTINGS.proxy.override,
    },
  };
}

export async function writeAppConfig(file: string, config: AppConfig): Promise<void> {
  await writeFileAtomic(file, renderAppConfig(config));
}

/** 只改应用设置段：界面常量与规则段保持文件原样。 */
export async function saveAppSettings(file: string, settings: Settings): Promise<void> {
  await writeAppConfig(file, { ...readAppConfig(file), settings });
}

/** 只改界面常量段：应用设置与规则段保持文件原样。 */
export async function saveUiConfig(file: string, ui: UiConfig, configFile?: string): Promise<void> {
  const current = readAppConfig(file);
  await writeAppConfig(file, {
    ...current,
    ui,
    configFile: configFile === undefined ? current.configFile : path.resolve(configFile),
  });
}

/** 统一配置文件名：工作目录下的 config.json。 */
export const APP_CONFIG_FILE = 'config.json';

/**
 * 候选位置：开发期是仓库根；打包后 appDir 是只读的 app.asar，工作目录改用 exe 同级
 * （= resources 的父目录）；两者都写不进去时才退回 data 目录。
 */
function candidates(appDir: string, dataDir: string): string[] {
  const list: string[] = [];
  // asar 内部只读，直接跳过，免得每次启动都报一次不可写
  if (!appDir.includes('.asar')) list.push(path.join(appDir, APP_CONFIG_FILE));
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath !== undefined) {
    list.push(path.join(path.dirname(resourcesPath), APP_CONFIG_FILE));
  }
  list.push(path.join(dataDir, APP_CONFIG_FILE));
  return list;
}

/**
 * 定位统一配置文件并按需预生成：优先工作目录，不可写时逐级退回。
 * 首次运行会把旧的 data/settings.json 并进来，并把它改名成 settings.json.migrated。
 */
export function ensureAppConfigFile(appDir: string, dataDir: string, log?: Logger): string {
  const targets = candidates(appDir, dataDir);
  const fallback = targets[targets.length - 1] ?? path.join(dataDir, APP_CONFIG_FILE);
  let target = fallback;

  for (const candidate of targets) {
    try {
      if (!fs.existsSync(candidate)) {
        fs.mkdirSync(path.dirname(candidate), { recursive: true });
        // "配置文件路径"这一项就是它自己，界面那一栏打开就有值
        fs.writeFileSync(
          candidate,
          renderAppConfig({ ...DEFAULT_APP_CONFIG, configFile: candidate }),
          'utf8',
        );
        log?.info({ file: candidate }, '已预生成统一配置文件 config.json');
      } else {
        // 老文件缺这一项就补上，免得界面上那一栏空着
        const current = readAppConfig(candidate);
        if (current.configFile === null) {
          fs.writeFileSync(candidate, renderAppConfig({ ...current, configFile: candidate }), 'utf8');
          log?.info({ file: candidate }, '统一配置文件已补上"配置文件路径"这一项');
        }
      }
      target = candidate;
      break;
    } catch (error) {
      log?.warn(
        { file: candidate, err: error instanceof Error ? error.message : String(error) },
        '统一配置文件不可用，改用备用路径',
      );
    }
  }

  migrateLegacySettings(target, dataDir, log);
  return target;
}

/** 旧的 data/settings.json 一次性并入统一配置文件，然后改名保留（不删用户数据）。 */
function migrateLegacySettings(target: string, dataDir: string, log?: Logger): void {
  const legacy = path.join(dataDir, 'settings.json');
  if (path.resolve(legacy) === path.resolve(target) || !fs.existsSync(legacy)) return;

  try {
    const raw = JSON.parse(fs.readFileSync(legacy, 'utf8')) as Partial<Settings>;
    const current = readAppConfig(target);
    const settings: Settings = {
      core: { ...current.settings.core, ...raw.core },
      subscription: { ...current.settings.subscription, ...raw.subscription },
      proxy: { ...current.settings.proxy, ...raw.proxy },
    };
    fs.writeFileSync(target, renderAppConfig({ ...current, settings }), 'utf8');
    fs.renameSync(legacy, `${legacy}.migrated`);
    log?.info({ legacy, target }, '已把旧的 data/settings.json 并入 config.json 并改名保留');
  } catch (error) {
    log?.warn(
      { legacy, err: error instanceof Error ? error.message : String(error) },
      '旧设置文件迁移失败，跳过',
    );
  }
}
