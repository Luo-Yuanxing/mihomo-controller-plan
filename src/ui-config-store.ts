/**
 * 界面常量的系统值持久化：存 SQLite 的 settings_kv 表（与前端 JSON 文件解耦）。
 * 文件只是加载源，系统值才是生效值，重启后从库里恢复。
 */
import type { Logger } from 'pino';
import type { RulesDatabase } from './rules/db.js';
import {
  DEFAULT_UI_CONFIG,
  parseUiConfig,
  resolveConfigFile,
  readUiConfigDocument,
  readUiConfigFile,
  setActiveUiConfig,
  type RuleEntry,
  type UiConfig,
} from './ui-config.js';

export const UI_CONFIG_KEY = 'ui-config';

export interface StoredUiConfig {
  file: string;
  config: UiConfig;
  updatedAt: string | null;
}

interface Row {
  value: string;
  updated_at: string;
}

/** 键值读写：系统设置的统一入口，后续其它运行期配置可复用。 */
export function readSetting(db: RulesDatabase, key: string): Row | null {
  const row = db.prepare('SELECT value, updated_at FROM settings_kv WHERE key = ?').get(key) as
    Row | undefined;
  return row ?? null;
}

export function writeSetting(db: RulesDatabase, key: string, value: unknown): string {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings_kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), updatedAt);
  return updatedAt;
}

/**
 * 启动时恢复系统值并设为生效值。
 * 库里没有记录时用配置文件初始化（文件不可用则用默认值），随即落库，之后以库为准。
 */
export function loadStoredUiConfig(db: RulesDatabase, defaultFile: string): StoredUiConfig {
  const row = readSetting(db, UI_CONFIG_KEY);
  if (row !== null) {
    const parsed = JSON.parse(row.value) as { file?: string; config?: unknown };
    const config = parseUiConfig(parsed.config);
    setActiveUiConfig(config);
    return { file: parsed.file ?? defaultFile, config, updatedAt: row.updated_at };
  }

  const file = defaultFile;
  let config = DEFAULT_UI_CONFIG;
  try {
    config = readUiConfigFile(defaultFile);
  } catch {
    // 配置文件不可用（首次启动等）：直接用默认值初始化系统值
  }
  const updatedAt = saveStoredUiConfig(db, file, config);
  return { file, config, updatedAt };
}

/** 写入系统值（持久化 + 立即生效）。 */
export function saveStoredUiConfig(db: RulesDatabase, file: string, config: UiConfig): string {
  const updatedAt = writeSetting(db, UI_CONFIG_KEY, { file, config });
  setActiveUiConfig(config);
  return updatedAt;
}

export interface UiConfigDiffItem {
  label: string;
  current: string;
  incoming: string;
  same: boolean;
}

/** 一次加载的结果：界面常量系统值 + 文件里带的规则（null = 文件没有 rules 段）。 */
export interface UiConfigLoadResult {
  state: StoredUiConfig;
  rules: RuleEntry[] | null;
}

/** 界面常量的系统值服务：server 与测试共用同一份编排逻辑。 */
export interface UiConfigService {
  state(): StoredUiConfig;
  forceLoad(file?: string): UiConfigLoadResult;
  preview(file?: string): {
    file: string;
    config: UiConfig;
    diff: UiConfigDiffItem[];
    rules: RuleEntry[] | null;
  };
  apply(input: { file?: string; config: unknown }): UiConfigLoadResult;
}

export function createUiConfigService(
  db: RulesDatabase,
  defaultFile: string,
  log?: Logger,
): UiConfigService {
  let state = loadStoredUiConfig(db, defaultFile);
  log?.info({ file: state.file, ruleTypes: state.config.ruleTypes }, '界面常量系统值已就绪');

  function commit(file: string, config: UiConfig, message: string): StoredUiConfig {
    const updatedAt = saveStoredUiConfig(db, file, config);
    state = { file, config, updatedAt };
    log?.info({ file, ruleTypes: config.ruleTypes }, message);
    return state;
  }

  return {
    state: () => state,
    forceLoad: (file?: string) => {
      // 严格：路径必须合法且文件存在
      const target = resolveConfigFile(file ?? state.file);
      const loaded = readUiConfigDocument(target);
      return {
        state: commit(target, loaded.config, '界面常量已按配置文件强制覆盖系统值'),
        rules: loaded.rules,
      };
    },
    preview: (file?: string) => {
      const target = resolveConfigFile(file ?? state.file);
      const loaded = readUiConfigDocument(target);
      return {
        file: target,
        config: loaded.config,
        diff: [
          ...diffUiConfig(state.file, state.config, target, loaded.config),
          item(
            '自定义规则（条）',
            String(countRules(db)),
            String(loaded.rules?.length ?? countRules(db)),
          ),
        ],
        rules: loaded.rules,
      };
    },
    apply: (input: { file?: string; config: unknown }) => ({
      state: commit(
        resolveConfigFile(input.file ?? state.file),
        parseUiConfig(input.config ?? DEFAULT_UI_CONFIG),
        '界面常量已从界面保存到系统',
      ),
      // 界面提交的只有界面常量，规则不动
      rules: null,
    }),
  };
}

function countRules(db: RulesDatabase): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM rules').get() as { total: number };
  return row.total;
}

function item(label: string, current: string, incoming: string): UiConfigDiffItem {
  return { label, current, incoming, same: current === incoming };
}

function policiesText(policies: UiConfig['policies']): string {
  return policies.map((option) => `${option.value}(${option.label})`).join(' / ');
}

/** 逐项对比系统值与待加载值，供界面标红显示。 */
export function diffUiConfig(
  currentFile: string,
  current: UiConfig,
  incomingFile: string,
  incoming: UiConfig,
): UiConfigDiffItem[] {
  return [
    item('配置文件路径', currentFile, incomingFile),
    item('规则类型', current.ruleTypes.join(' / '), incoming.ruleTypes.join(' / ')),
    item('目标策略', policiesText(current.policies), policiesText(incoming.policies)),
    item('默认规则类型', current.defaults.ruleType, incoming.defaults.ruleType),
    item('默认目标策略', current.defaults.policy, incoming.defaults.policy),
    item(
      '失败连接轮询（ms）',
      String(current.failedConnections.refetchIntervalMs),
      String(incoming.failedConnections.refetchIntervalMs),
    ),
    item(
      '失败连接扫描行数',
      String(current.failedConnections.lines),
      String(incoming.failedConnections.lines),
    ),
    item(
      '日志轮询（ms）',
      String(current.settings.logsRefetchIntervalMs),
      String(incoming.settings.logsRefetchIntervalMs),
    ),
  ];
}
