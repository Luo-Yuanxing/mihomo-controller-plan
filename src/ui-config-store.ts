/**
 * 导入设置的编排：生效值就是工作目录里 config.json 的界面常量段。
 * 文件对用户透明——界面只有"字符串导入 / 立即初始化"两个入口，其余全自动；
 * 加载时就把初始化标记落成 false，不做任何引导流程。
 */
import fs from 'node:fs';
import type { Logger } from 'pino';
import {
  markInitialized,
  markInitializedSync,
  readAppConfig,
  saveBlacklistHosts,
  saveUiConfig,
  writeAppConfig,
} from './app-config.js';
import { parseUiConfig, setActiveUiConfig, type RuleEntry, type UiConfig } from './ui-config.js';
import {
  decodeSharedConfig,
  encodeSharedConfig,
  type ShareableApp,
  type SharedConfig,
} from './ui-config-share.js';

export interface StoredUiConfig {
  config: UiConfig;
  /** false = 启动就是初始化完成的生效态，界面不加载引导。 */
  initialized: boolean;
  /** config.json 的最后修改时间，读不到就是 null。 */
  updatedAt: string | null;
}

/** 一次导入的结果：生效值 + 文件里带的规则（null = 没带 rules 段）。 */
export interface UiConfigImportResult {
  state: StoredUiConfig;
  rules: RuleEntry[] | null;
  /** 导入串里带的内核/代理设置，由调用方决定怎么套用。 */
  app: SharedConfig['app'];
}

export interface UiConfigService {
  state(): StoredUiConfig;
  /** 保存界面常量：存过一次就算配置好了（initialized → false）。 */
  apply(config: unknown): Promise<StoredUiConfig>;
  /** 立即初始化：把标记落成 false，内容不动（正常情况下加载时就已经是 false）。 */
  initialize(): Promise<StoredUiConfig>;
  /** 只改失败连接黑名单的主机列表：落盘并刷新内存里的生效值。 */
  saveBlacklist(hosts: string[]): Promise<UiConfig>;
  /** 生成分享串（含规则与内核/代理设置，剔除订阅与 secret）。 */
  share(rules: RuleEntry[], app: ShareableApp): string;
  /** 解析分享串：只解析不落盘，字段不合法直接抛错。 */
  decode(payload: string): SharedConfig;
  /** 导入分享串：界面常量（+规则段）落盘，并把 initialized 置为 false。 */
  importShared(payload: string): Promise<UiConfigImportResult>;
}

function modifiedAt(file: string): string | null {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}

export function createUiConfigService(defaultFile: string, log?: Logger): UiConfigService {
  const file = defaultFile;
  const initial = readAppConfig(file);
  // 加载即完成初始化：标记还是 true（旧版本落下的文件）就同步落成 false，界面不加载引导
  if (initial.initialized) {
    try {
      markInitializedSync(file);
      log?.info({ file }, '加载时已把初始化标记落成 false');
    } catch (error) {
      log?.warn(
        { file, err: error instanceof Error ? error.message : String(error) },
        '加载时写初始化标记失败，本次仍按已初始化运行',
      );
    }
  }
  setActiveUiConfig(initial.ui);

  let state: StoredUiConfig = {
    config: initial.ui,
    initialized: false,
    updatedAt: modifiedAt(file),
  };
  log?.info(
    { file, initialized: false, ruleTypes: state.config.ruleTypes },
    '界面常量生效值已就绪',
  );

  /** 内存里的生效值必须跟着文件走：规则类型白名单是按它校验的。 */
  function next(config: UiConfig, initialized: boolean): StoredUiConfig {
    setActiveUiConfig(config);
    state = { config, initialized, updatedAt: modifiedAt(file) };
    return state;
  }

  return {
    state: () => state,
    async apply(config: unknown) {
      const parsed = parseUiConfig(config);
      await saveUiConfig(file, parsed, false);
      return next(parsed, false);
    },
    async initialize() {
      await markInitialized(file);
      log?.info({ file }, '已把初始化标记落成 false');
      return next(state.config, false);
    },
    async saveBlacklist(hosts) {
      const ui = await saveBlacklistHosts(file, hosts);
      // 生效值跟着文件走：页面上的筛选读的就是这里，改完不用重启
      setActiveUiConfig(ui);
      state = { ...state, config: ui, updatedAt: modifiedAt(file) };
      log?.info({ count: hosts.length }, '黑名单已保存');
      return ui;
    },
    share(rules, app) {
      return encodeSharedConfig({ config: state.config, rules, app });
    },
    decode: (payload: string) => decodeSharedConfig(payload),
    async importShared(payload: string) {
      const shared = decodeSharedConfig(payload);
      // 导入的界面常量与规则段一起落盘；应用设置交给调用方走 /api/settings 那条路
      await writeAppConfig(file, {
        ...readAppConfig(file),
        ui: shared.config,
        ...(shared.rules === null ? {} : { rules: shared.rules }),
        initialized: false,
      });
      log?.info({ file, rules: shared.rules?.length ?? null }, '已导入配置字符串');
      return { state: next(shared.config, false), rules: shared.rules, app: shared.app };
    },
  };
}
