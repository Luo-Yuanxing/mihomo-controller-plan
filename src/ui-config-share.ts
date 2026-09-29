/**
 * 配置分享串：把一份配置编成 Base64 字符串，供用户在面板之间粘贴传递。
 *
 * 只装"可搬运"的部分：界面常量 + 自定义规则 + 内核路径/混合端口 + 系统代理期望值。
 * 明确排除订阅（URL / User-Agent / 下载设置）与内核 secret —— 订阅链接是私人凭据，不外传。
 */
import {
  parseUiConfigFile,
  UiConfigValidationError,
  type AppSettingsFile,
  type RuleEntry,
  type UiConfig,
} from './ui-config.js';

/** 分享串长度上限：正常一份配置几 KB，超过这个量级肯定是粘错了。 */
const MAX_PAYLOAD_BYTES = 256 * 1024;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

export interface SharedConfig {
  config: UiConfig;
  /** null = 这份配置没带规则段。 */
  rules: RuleEntry[] | null;
  /** 只会有 core（内核路径/端口）与 proxy（系统代理期望值）两段。 */
  app: AppSettingsFile | null;
}

/** 可搬运的应用设置：订阅与 secret 一律不出门。 */
export interface ShareableApp {
  core?: { binaryPath: string; mixedPort: number };
  proxy?: { enabled: boolean; override: string };
}

/** 编码：JSON → UTF-8 → Base64URL（无 = 填充，方便直接粘进聊天框）。 */
export function encodeSharedConfig(input: {
  config: UiConfig;
  rules: RuleEntry[];
  app: ShareableApp;
}): string {
  const { core, proxy } = input.app;
  const payload = {
    ...input.config,
    rules: input.rules,
    ...(core === undefined ? {} : { core }),
    ...(proxy === undefined ? {} : { proxy }),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * 解码：格式/字段任何一处不对都抛带可读原因的错，绝不半套用。
 * 复用配置文件那一套严格校验（规则类型白名单、跨字段一致性都在里面）。
 */
export function decodeSharedConfig(text: string): SharedConfig {
  // 长串在聊天工具/文本框里难免被折行或插空格，一律先清掉空白：它只是一串 Base64，不需要词边界
  const raw = text.replace(/\s+/g, '');
  if (raw === '') {
    throw new UiConfigValidationError([{ path: 'payload', message: '导入串不能为空' }]);
  }
  if (!BASE64URL_PATTERN.test(raw)) {
    throw new UiConfigValidationError([
      { path: 'payload', message: '不是合法的 Base64URL 字符串' },
    ]);
  }

  const buffer = Buffer.from(raw, 'base64url');
  if (buffer.length === 0) {
    throw new UiConfigValidationError([{ path: 'payload', message: '导入串解出来是空的' }]);
  }
  if (buffer.length > MAX_PAYLOAD_BYTES) {
    throw new UiConfigValidationError([
      { path: 'payload', message: `导入串过大（上限 ${String(MAX_PAYLOAD_BYTES)} 字节）` },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new UiConfigValidationError([
      { path: 'payload', message: '导入串解出来不是合法 JSON' },
    ]);
  }

  const loaded = parseUiConfigFile(parsed);
  return {
    config: loaded.config,
    rules: loaded.rules,
    // 订阅段与 secret 即便被人塞进串里也丢掉：这两样只属于本机
    app: shareableApp(loaded.app),
  };
}

/** 只留内核路径/端口与系统代理期望值，其余字段（订阅、secret）一律丢弃。 */
function shareableApp(app: AppSettingsFile | null): AppSettingsFile | null {
  if (app === null) return null;
  const core = app.core;
  const proxy = app.proxy;
  const next: AppSettingsFile = {};
  if (core !== undefined) {
    next.core = {
      ...(core.binaryPath === undefined ? {} : { binaryPath: core.binaryPath }),
      ...(core.mixedPort === undefined ? {} : { mixedPort: core.mixedPort }),
    };
  }
  if (proxy !== undefined) {
    next.proxy = {
      ...(proxy.enabled === undefined ? {} : { enabled: proxy.enabled }),
      ...(proxy.override === undefined ? {} : { override: proxy.override }),
    };
  }
  return next.core === undefined && next.proxy === undefined ? null : next;
}
