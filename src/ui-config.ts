/**
 * 界面常量：结构定义、默认值、配置文件读取、内存中的系统值。
 * 前端配置文件（JSON，可放到任意路径）与后端持久化（SQLite，见 ui-config-store.ts）分离：
 * 文件只作"加载源"，系统值由后端独立保存，重启后仍生效。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';

export const uiConfigSchema = z.object({
  /** 规则类型下拉项，同时作为后端写入白名单。 */
  ruleTypes: z.array(z.string().min(1)).min(1),
  /** 目标策略下拉项。 */
  policies: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(1),
  defaults: z.object({ ruleType: z.string().min(1), policy: z.string().min(1) }),
  failedConnections: z.object({
    refetchIntervalMs: z.number().int().min(1000),
    lines: z.number().int().min(1),
  }),
  settings: z.object({ logsRefetchIntervalMs: z.number().int().min(1000) }),
});

export type UiConfig = z.infer<typeof uiConfigSchema>;

/** config.json 里可以带的自定义规则（和规则页提交的结构一致，不含 id/position）。 */
export const ruleEntrySchema = z.object({
  enabled: z.boolean().default(true),
  type: z.string().min(1),
  value: z.string().min(1),
  policy: z.string().min(1),
  noResolve: z.boolean().default(true),
});

export type RuleEntry = z.infer<typeof ruleEntrySchema>;

export const uiConfigFileSchema = uiConfigSchema.extend({
  /** 导出时一并写出的规则；加载时会整表覆盖库里的规则。 */
  rules: z.array(ruleEntrySchema).optional(),
});

/** 应用设置（内核/订阅/系统代理）能出现在 config.json 里的字段，都是可选的。 */
export const appSettingsFileSchema = z.object({
  core: z
    .object({
      binaryPath: z.string().min(1),
      mixedPort: z.number().int().min(1).max(65535),
    })
    .partial()
    .optional(),
  subscription: z
    .object({
      url: z.string(),
      useProxy: z.boolean(),
      userAgent: z.string().min(1),
      proxyGroup: z.string(),
    })
    .partial()
    .optional(),
  proxy: z.object({ override: z.string() }).partial().optional(),
});

export type AppSettingsFile = z.infer<typeof appSettingsFileSchema>;

export interface UiConfigIssue {
  path: string;
  message: string;
}

export class UiConfigValidationError extends Error {
  constructor(
    readonly issues: UiConfigIssue[],
    context?: string,
  ) {
    const detail = issues
      .map((issue) => `${issue.path === '' ? '配置' : issue.path}：${issue.message}`)
      .join('；');
    super(context === undefined ? detail : `${context}：${detail}`);
    this.name = 'UiConfigValidationError';
  }
}

/** 取值规则上限；前端 ui/src/lib/validateUiConfig.ts 保持同一份规则。 */
export const UI_CONFIG_LIMITS = {
  maxRuleTypes: 20,
  maxPolicies: 20,
  refetchIntervalMs: { min: 1000, max: 60000 },
  failedLines: { min: 100, max: 20000 },
} as const;

const RULE_TYPE_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkInterval(
  issues: UiConfigIssue[],
  path: string,
  value: unknown,
  range: { min: number; max: number },
): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.push({ path, message: '必须是整数' });
    return;
  }
  if (value < range.min || value > range.max) {
    issues.push({ path, message: `需在 ${String(range.min)}-${String(range.max)} 之间` });
  }
}

/**
 * 逐项检查配置文件/界面提交的值（结构 + 跨字段一致性 + 取值范围）。
 * 前后端各实现一份，规则必须一致：tests/ui/ui-config-validation.test.ts 会对拍。
 */
export function uiConfigIssues(raw: unknown): UiConfigIssue[] {
  const issues: UiConfigIssue[] = [];
  if (!isRecord(raw)) return [{ path: '', message: '必须是 JSON 对象' }];

  const ruleTypes = raw['ruleTypes'];
  const ruleTypeValues: string[] = [];
  if (!Array.isArray(ruleTypes)) {
    issues.push({ path: 'ruleTypes', message: '必须是字符串数组' });
  } else {
    if (ruleTypes.length === 0) issues.push({ path: 'ruleTypes', message: '不能为空' });
    if (ruleTypes.length > UI_CONFIG_LIMITS.maxRuleTypes) {
      issues.push({
        path: 'ruleTypes',
        message: `最多 ${String(UI_CONFIG_LIMITS.maxRuleTypes)} 项`,
      });
    }
    const seen = new Set<string>();
    ruleTypes.forEach((value, index) => {
      const path = `ruleTypes[${String(index)}]`;
      if (typeof value !== 'string') {
        issues.push({ path, message: '必须是字符串' });
        return;
      }
      const text = value.trim();
      if (text === '') {
        issues.push({ path, message: '不能为空字符串' });
        return;
      }
      if (!RULE_TYPE_PATTERN.test(text)) {
        issues.push({ path, message: '只能是大写字母、数字或连字符' });
        return;
      }
      if (seen.has(text)) {
        issues.push({ path, message: `重复项：${text}` });
        return;
      }
      seen.add(text);
      ruleTypeValues.push(text);
    });
  }

  const policies = raw['policies'];
  const policyValues: string[] = [];
  if (!Array.isArray(policies)) {
    issues.push({ path: 'policies', message: '必须是数组' });
  } else {
    if (policies.length === 0) issues.push({ path: 'policies', message: '不能为空' });
    if (policies.length > UI_CONFIG_LIMITS.maxPolicies) {
      issues.push({ path: 'policies', message: `最多 ${String(UI_CONFIG_LIMITS.maxPolicies)} 项` });
    }
    policies.forEach((value, index) => {
      const base = `policies[${String(index)}]`;
      if (!isRecord(value)) {
        issues.push({ path: base, message: '必须是 { value, label } 对象' });
        return;
      }
      const items: [string, string][] = [
        ['value', '策略值'],
        ['label', '显示名'],
      ];
      for (const [key, label] of items) {
        const text = value[key];
        if (typeof text !== 'string' || text.trim() === '') {
          issues.push({ path: `${base}.${key}`, message: `${label}不能为空` });
        } else if (key === 'value' && text.includes(',')) {
          issues.push({ path: `${base}.${key}`, message: `${label}不能包含逗号` });
        }
      }
      const policyValue = typeof value['value'] === 'string' ? value['value'].trim() : '';
      if (policyValue !== '' && policyValues.includes(policyValue)) {
        issues.push({ path: `${base}.value`, message: `重复项：${policyValue}` });
        return;
      }
      if (policyValue !== '') policyValues.push(policyValue);
    });
  }

  const defaults = raw['defaults'];
  if (!isRecord(defaults)) {
    issues.push({ path: 'defaults', message: '必须是对象' });
  } else {
    const ruleType = defaults['ruleType'];
    if (typeof ruleType !== 'string' || ruleType.trim() === '') {
      issues.push({ path: 'defaults.ruleType', message: '默认规则类型不能为空' });
    } else if (!ruleTypeValues.includes(ruleType.trim())) {
      issues.push({ path: 'defaults.ruleType', message: `不在规则类型列表里：${ruleType.trim()}` });
    }
    const policy = defaults['policy'];
    if (typeof policy !== 'string' || policy.trim() === '') {
      issues.push({ path: 'defaults.policy', message: '默认目标策略不能为空' });
    } else if (!policyValues.includes(policy.trim())) {
      issues.push({ path: 'defaults.policy', message: `不在目标策略列表里：${policy.trim()}` });
    }
  }

  const failed = raw['failedConnections'];
  if (!isRecord(failed)) {
    issues.push({ path: 'failedConnections', message: '必须是对象' });
  } else {
    checkInterval(
      issues,
      'failedConnections.refetchIntervalMs',
      failed['refetchIntervalMs'],
      UI_CONFIG_LIMITS.refetchIntervalMs,
    );
    checkInterval(issues, 'failedConnections.lines', failed['lines'], UI_CONFIG_LIMITS.failedLines);
  }

  const settings = raw['settings'];
  if (!isRecord(settings)) {
    issues.push({ path: 'settings', message: '必须是对象' });
  } else {
    checkInterval(
      issues,
      'settings.logsRefetchIntervalMs',
      settings['logsRefetchIntervalMs'],
      UI_CONFIG_LIMITS.refetchIntervalMs,
    );
  }

  return issues;
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  ruleTypes: ['DOMAIN-SUFFIX', 'DOMAIN'],
  policies: [
    { value: 'PROXY', label: '代理' },
    { value: 'DIRECT', label: '直连' },
  ],
  defaults: { ruleType: 'DOMAIN-SUFFIX', policy: 'PROXY' },
  failedConnections: { refetchIntervalMs: 5000, lines: 5000 },
  settings: { logsRefetchIntervalMs: 5000 },
};

/** 预生成的 config.json：界面默认值 + 空规则表（让用户一眼看到 rules 键）。 */
export const DEFAULT_UI_CONFIG_FILE = { ...DEFAULT_UI_CONFIG, rules: [] };

/** 文件级校验：界面常量 + 可选的 rules 段（类型要在 ruleTypes 白名单里）。 */
export function uiConfigFileIssues(raw: unknown): UiConfigIssue[] {
  const issues = uiConfigIssues(raw);
  if (!isRecord(raw)) return issues;

  const core = raw['core'];
  if (isRecord(core)) {
    const binaryPath = core['binaryPath'];
    if (binaryPath !== undefined && (typeof binaryPath !== 'string' || binaryPath.trim() === '')) {
      issues.push({ path: 'core.binaryPath', message: '不能为空' });
    }
    const mixedPort = core['mixedPort'];
    if (
      mixedPort !== undefined &&
      (typeof mixedPort !== 'number' ||
        !Number.isInteger(mixedPort) ||
        mixedPort < 1 ||
        mixedPort > 65535)
    ) {
      issues.push({ path: 'core.mixedPort', message: '需在 1-65535 之间' });
    }
  } else if (core !== undefined) {
    issues.push({ path: 'core', message: '必须是对象' });
  }

  const rules = raw['rules'];
  if (rules === undefined) return issues;
  if (!Array.isArray(rules)) {
    issues.push({ path: 'rules', message: '必须是数组' });
    return issues;
  }

  const ruleTypes = Array.isArray(raw['ruleTypes'])
    ? raw['ruleTypes'].filter((value): value is string => typeof value === 'string')
    : [];

  rules.forEach((entry, index) => {
    const path = `rules[${String(index)}]`;
    if (!isRecord(entry)) {
      issues.push({ path, message: '必须是对象' });
      return;
    }
    const type = entry['type'];
    if (typeof type !== 'string' || !ruleTypes.includes(type)) {
      issues.push({ path: `${path}.type`, message: `不在规则类型列表里：${String(type)}` });
    }
    for (const key of ['value', 'policy'] as const) {
      const text = entry[key];
      if (typeof text !== 'string' || text.trim() === '') {
        issues.push({ path: `${path}.${key}`, message: '不能为空' });
      }
    }
  });

  return issues;
}

/** 解析配置文件：界面常量、规则、应用设置三段；缺席的段为 null。 */
export function parseUiConfigFile(raw: unknown): {
  config: UiConfig;
  rules: RuleEntry[] | null;
  app: AppSettingsFile | null;
} {
  const issues = uiConfigFileIssues(raw);
  if (issues.length > 0) throw new UiConfigValidationError(issues);
  const { rules, core, subscription, proxy, ...rest } = uiConfigFileSchema
    .extend(appSettingsFileSchema.shape)
    .parse(raw);
  const app = appSettingsFileSchema.parse({ core, subscription, proxy });
  const hasApp =
    app.core !== undefined || app.subscription !== undefined || app.proxy !== undefined;
  return { config: uiConfigSchema.parse(rest), rules: rules ?? null, app: hasApp ? app : null };
}

/** 生成导出内容：界面常量 + 自定义规则 + 应用设置（内核/订阅/系统代理）。 */
export function renderUiConfigFile(
  config: UiConfig,
  rules: RuleEntry[],
  app: AppSettingsFile | null = null,
): string {
  return `${JSON.stringify(uiConfigFileSchema.extend(appSettingsFileSchema.shape).parse({ ...config, rules, ...app }), null, 2)}\n`;
}

/** 导出目标：非空 + .json，允许文件不存在（导出就是新建），父目录自动建。 */
export function resolveExportTarget(file: string): string {
  const raw = file.trim();
  if (raw === '') {
    throw new UiConfigValidationError([{ path: 'file', message: '导出路径不能为空' }]);
  }
  if (path.extname(raw).toLowerCase() !== '.json') {
    throw new UiConfigValidationError([{ path: 'file', message: '导出文件必须以 .json 结尾' }]);
  }
  const resolved = path.resolve(raw);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

export function uiConfigPath(dataDir: string): string {
  return path.join(dataDir, 'config.json');
}

/**
 * 严格解析配置文件路径：非空 + 以 .json 结尾 + 存在且是文件，返回绝对路径。
 * 只由用户触发的加载/预览/保存调用；启动恢复系统值不做这一步（库里旧路径失效不应挡住启动）。
 */
export function resolveConfigFile(file: string): string {
  const raw = file.trim();
  if (raw === '') {
    throw new UiConfigValidationError([{ path: 'file', message: '配置文件路径不能为空' }]);
  }
  if (path.extname(raw).toLowerCase() !== '.json') {
    throw new UiConfigValidationError([{ path: 'file', message: '配置文件必须以 .json 结尾' }]);
  }
  const resolved = path.resolve(raw);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new UiConfigValidationError([
      { path: 'file', message: `配置文件不存在或不可读：${resolved}` },
    ]);
  }
  if (!stat.isFile()) {
    throw new UiConfigValidationError([{ path: 'file', message: `不是文件：${resolved}` }]);
  }
  return resolved;
}

/**
 * 启动时在 app 启动路径预生成配置文件（内容为默认值），该目录不可写时退回 data 目录。
 * 只负责"有文件可改"，系统值仍以后端持久化数据为准。
 */
export function ensureUiConfigFile(appDir: string, dataDir: string, log?: Logger): string {
  const fallback = uiConfigPath(dataDir);
  for (const target of [path.join(appDir, 'config.json'), fallback]) {
    try {
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `${JSON.stringify(DEFAULT_UI_CONFIG_FILE, null, 2)}\n`, 'utf8');
        log?.info({ file: target }, '已预生成界面常量配置文件');
      }
      return target;
    } catch (error) {
      log?.warn(
        { file: target, err: error instanceof Error ? error.message : String(error) },
        '界面常量配置文件不可用，改用备用路径',
      );
    }
  }
  return fallback;
}

let active: UiConfig = DEFAULT_UI_CONFIG;

/** 当前生效的界面常量。 */
export function getUiConfig(): UiConfig {
  return active;
}

/** 更新内存中的系统值（调用方负责持久化）。 */
export function setActiveUiConfig(config: UiConfig): UiConfig {
  active = config;
  return active;
}

/** 规则类型白名单（后端校验与渲染共用，改 JSON 后需重载才生效）。 */
export function getRuleTypes(): readonly string[] {
  return active.ruleTypes;
}

/** 校验外部 JSON（文件内容或界面提交值）。 */
export function parseUiConfig(raw: unknown): UiConfig {
  const issues = uiConfigIssues(raw);
  if (issues.length > 0) throw new UiConfigValidationError(issues);
  return uiConfigSchema.parse(raw);
}

/**
 * 读配置文件：缺文件、空文件、非法 JSON、缺字段都抛错（带可读原因），
 * 由调用方决定回退策略——所以空文件不会被当成"全空配置"加载。
 */
export function readUiConfigFile(file: string): UiConfig {
  return readUiConfigDocument(file).config;
}

/** 读配置文件全文：界面常量 + 可选的 rules 段。 */
export function readUiConfigDocument(file: string): {
  config: UiConfig;
  rules: RuleEntry[] | null;
  app: AppSettingsFile | null;
} {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`配置文件不存在或不可读：${file}`);
  }
  if (text.trim() === '') {
    throw new Error(`配置文件是空文件（需要至少含 ruleTypes 等字段）：${file}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `配置文件不是合法 JSON：${file}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }

  try {
    return parseUiConfigFile(raw);
  } catch (error) {
    if (error instanceof UiConfigValidationError) {
      throw new UiConfigValidationError(error.issues, `配置文件字段不合法：${file}`);
    }
    throw error;
  }
}
