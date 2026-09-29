/**
 * 界面常量的编排：生效值就是工作目录里统一配置文件 config.json 的界面常量段。
 * 文件即唯一真相源——不再有 SQLite 副本，改文件即改生效值，重启后自然还在。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { readAppConfig, saveUiConfig } from './app-config.js';
import {
  parseUiConfig,
  readUiConfigDocument,
  resolveConfigFile,
  setActiveUiConfig,
  type AppSettingsFile,
  type RuleEntry,
  type UiConfig,
} from './ui-config.js';
import type { Settings } from './settings.js';

export interface StoredUiConfig {
  /** 生效值的来源文件（默认就是统一配置文件 config.json）。 */
  file: string;
  config: UiConfig;
  /** 来源文件的最后修改时间，读不到就是 null。 */
  updatedAt: string | null;
}

export interface UiConfigDiffItem {
  label: string;
  current: string;
  incoming: string;
  same: boolean;
}

/** 一次加载的结果：生效值 + 文件里带的规则（null = 文件没有 rules 段）+ 应用设置段。 */
export interface UiConfigLoadResult {
  state: StoredUiConfig;
  rules: RuleEntry[] | null;
  app: AppSettingsFile | null;
}

/** 界面常量的生效值服务：server 与测试共用同一份编排逻辑。 */
export interface UiConfigService {
  state(): StoredUiConfig;
  forceLoad(file?: string): Promise<UiConfigLoadResult>;
  preview(file?: string): {
    file: string;
    config: UiConfig;
    diff: UiConfigDiffItem[];
    rules: RuleEntry[] | null;
    app: AppSettingsFile | null;
  };
  apply(input: { file?: string; config: unknown }): Promise<UiConfigLoadResult>;
}

function modifiedAt(file: string): string | null {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}

export function createUiConfigService(
  defaultFile: string,
  log?: Logger,
  deps?: { currentSettings?: () => Settings; countRules?: () => number },
): UiConfigService {
  /** 生效值只住这一个文件：apply 与"从别处加载"都写回它。 */
  const unifiedFile = defaultFile;
  const initial = readAppConfig(unifiedFile);
  setActiveUiConfig(initial.ui);

  let state: StoredUiConfig = {
    file: unifiedFile,
    config: initial.ui,
    updatedAt: modifiedAt(unifiedFile),
  };
  log?.info({ file: state.file, ruleTypes: state.config.ruleTypes }, '界面常量生效值已就绪');

  const countRules = (): number => deps?.countRules?.() ?? readAppConfig(unifiedFile).rules?.length ?? 0;

  /** 写生效值：来源文件不是统一文件时，内容同时落进统一文件，重启后才还在。 */
  async function commit(source: string, config: UiConfig, message: string): Promise<StoredUiConfig> {
    await saveUiConfig(unifiedFile, config);
    setActiveUiConfig(config);
    if (path.resolve(source) !== path.resolve(unifiedFile)) {
      log?.info({ source, unifiedFile }, '生效值来自外部文件，已同步写回统一配置文件');
    }
    state = { file: source, config, updatedAt: modifiedAt(source) };
    log?.info({ file: source, ruleTypes: config.ruleTypes }, message);
    return state;
  }

  return {
    state: () => state,
    forceLoad: async (file?: string) => {
      // 严格：路径必须合法且文件存在
      const target = resolveConfigFile(file ?? state.file);
      const loaded = readUiConfigDocument(target);
      return {
        state: await commit(target, loaded.config, '界面常量已按配置文件强制覆盖生效值'),
        rules: loaded.rules,
        app: loaded.app,
      };
    },
    preview: (file?: string) => {
      const target = resolveConfigFile(file ?? state.file);
      const loaded = readUiConfigDocument(target);
      const current = deps?.currentSettings?.();
      return {
        file: target,
        config: loaded.config,
        diff: [
          ...diffUiConfig(state.file, state.config, target, loaded.config),
          item('自定义规则（条）', String(countRules()), String(loaded.rules?.length ?? countRules())),
          ...(current === undefined ? [] : diffSettings(current, loaded.app)),
        ],
        rules: loaded.rules,
        app: loaded.app,
      };
    },
    apply: async (input: { file?: string; config: unknown }) => {
      // 目标路径只做校验：生效值固定落统一配置文件，界面"另存为"走导出接口
      if (input.file !== undefined) resolveConfigFile(input.file);
      return {
        state: await commit(
          unifiedFile,
          parseUiConfig(input.config),
          '界面常量已从界面保存到统一配置文件',
        ),
        // 界面提交的只有界面常量，规则不动
        rules: null,
        app: null,
      };
    },
  };
}

/** 应用设置逐项对比：只列文件里带了的那几项。 */
function diffSettings(current: Settings, incoming: AppSettingsFile | null): UiConfigDiffItem[] {
  if (incoming === null) return [];
  const items: UiConfigDiffItem[] = [];
  if (incoming.core?.binaryPath !== undefined) {
    items.push(item('内核路径', current.core.binaryPath, incoming.core.binaryPath));
  }
  if (incoming.core?.mixedPort !== undefined) {
    items.push(item('混合端口', String(current.core.mixedPort), String(incoming.core.mixedPort)));
  }
  if (incoming.subscription?.url !== undefined) {
    items.push(item('订阅 URL', current.subscription.url, incoming.subscription.url));
  }
  if (incoming.subscription?.userAgent !== undefined) {
    items.push(
      item('订阅 User-Agent', current.subscription.userAgent, incoming.subscription.userAgent),
    );
  }
  if (incoming.subscription?.useProxy !== undefined) {
    items.push(
      item(
        '订阅下载走代理',
        String(current.subscription.useProxy),
        String(incoming.subscription.useProxy),
      ),
    );
  }
  if (incoming.subscription?.proxyGroup !== undefined) {
    items.push(
      item(
        'PROXY 指代',
        current.subscription.proxyGroup === '' ? '订阅全部节点' : current.subscription.proxyGroup,
        incoming.subscription.proxyGroup === '' ? '订阅全部节点' : incoming.subscription.proxyGroup,
      ),
    );
  }
  if (incoming.proxy?.override !== undefined) {
    items.push(item('ProxyOverride', current.proxy.override, incoming.proxy.override));
  }
  return items;
}

function item(label: string, current: string, incoming: string): UiConfigDiffItem {
  return { label, current, incoming, same: current === incoming };
}

function policiesText(policies: UiConfig['policies']): string {
  return policies.map((option) => `${option.value}(${option.label})`).join(' / ');
}

/** 逐项对比生效值与待加载值，供界面标红显示。 */
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
