/**
 * 界面常量：结构定义、默认值、文件解析、内存中的生效值。
 * 持久化见 app-config.ts：界面常量与应用设置同住在工作目录的 config.json 里，文件就是唯一真相源。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isLanguage, setLanguage, t } from './i18n.js';

export const uiConfigSchema = z.object({
  /** 界面语言：只有中文与英语两套，默认中文。 */
  language: z.enum(['zh', 'en']).default('zh'),
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

/** 应用设置（内核/订阅/系统代理）在统一配置文件里的字段，都是可选的（缺项按默认值补齐）。 */
export const appSettingsFileSchema = z.object({
  core: z
    .object({
      binaryPath: z.string().min(1),
      mixedPort: z.number().int().min(1).max(65535),
      secret: z.string(),
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
  proxy: z.object({ enabled: z.boolean(), override: z.string() }).partial().optional(),
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
    const root = t('uiConfig.root');
    const detail = issues
      .map((issue) =>
        t('uiConfig.issue', {
          path: issue.path === '' ? root : issue.path,
          message: issue.message,
        }),
      )
      .join(t('uiConfig.issueSeparator'));
    super(context === undefined ? detail : t('uiConfig.issue', { path: context, message: detail }));
    this.name = 'UiConfigValidationError';
  }
}

/** 取值规则上限；前置校验与导出都用这一份。 */
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
    issues.push({ path, message: t('uiConfig.mustBeInteger') });
    return;
  }
  if (value < range.min || value > range.max) {
    issues.push({
      path,
      message: t('uiConfig.outOfRange', { min: range.min, max: range.max }),
    });
  }
}

/** 逐项检查配置文件/界面提交的值（结构 + 跨字段一致性 + 取值范围），错误带可读字段名。 */
export function uiConfigIssues(raw: unknown): UiConfigIssue[] {
  const issues: UiConfigIssue[] = [];
  if (!isRecord(raw)) return [{ path: '', message: t('uiConfig.mustBeJsonObject') }];

  const language = raw['language'];
  if (language !== undefined && !isLanguage(language)) {
    issues.push({ path: 'language', message: t('uiConfig.languageUnsupported') });
  }

  const ruleTypes = raw['ruleTypes'];
  const ruleTypeValues: string[] = [];
  if (!Array.isArray(ruleTypes)) {
    issues.push({ path: 'ruleTypes', message: t('uiConfig.mustBeStringArray') });
  } else {
    if (ruleTypes.length === 0) issues.push({ path: 'ruleTypes', message: t('uiConfig.notEmpty') });
    if (ruleTypes.length > UI_CONFIG_LIMITS.maxRuleTypes) {
      issues.push({
        path: 'ruleTypes',
        message: t('uiConfig.tooManyItems', { max: UI_CONFIG_LIMITS.maxRuleTypes }),
      });
    }
    const seen = new Set<string>();
    ruleTypes.forEach((value, index) => {
      const path = `ruleTypes[${String(index)}]`;
      if (typeof value !== 'string') {
        issues.push({ path, message: t('uiConfig.mustBeString') });
        return;
      }
      const text = value.trim();
      if (text === '') {
        issues.push({ path, message: t('uiConfig.notEmptyString') });
        return;
      }
      if (!RULE_TYPE_PATTERN.test(text)) {
        issues.push({ path, message: t('uiConfig.ruleTypePattern') });
        return;
      }
      if (seen.has(text)) {
        issues.push({ path, message: t('uiConfig.duplicate', { value: text }) });
        return;
      }
      seen.add(text);
      ruleTypeValues.push(text);
    });
  }

  const policies = raw['policies'];
  const policyValues: string[] = [];
  if (!Array.isArray(policies)) {
    issues.push({ path: 'policies', message: t('uiConfig.mustBeArray') });
  } else {
    if (policies.length === 0) issues.push({ path: 'policies', message: t('uiConfig.notEmpty') });
    if (policies.length > UI_CONFIG_LIMITS.maxPolicies) {
      issues.push({
        path: 'policies',
        message: t('uiConfig.tooManyItems', { max: UI_CONFIG_LIMITS.maxPolicies }),
      });
    }
    policies.forEach((value, index) => {
      const base = `policies[${String(index)}]`;
      if (!isRecord(value)) {
        issues.push({ path: base, message: t('uiConfig.policyShape') });
        return;
      }
      const items = [
        { key: 'value', empty: 'uiConfig.policyValueEmpty' },
        { key: 'label', empty: 'uiConfig.policyLabelEmpty' },
      ] as const;
      for (const item of items) {
        const text = value[item.key];
        if (typeof text !== 'string' || text.trim() === '') {
          issues.push({ path: `${base}.${item.key}`, message: t(item.empty) });
        } else if (item.key === 'value' && text.includes(',')) {
          issues.push({ path: `${base}.${item.key}`, message: t('uiConfig.policyValueComma') });
        }
      }
      const policyValue = typeof value['value'] === 'string' ? value['value'].trim() : '';
      if (policyValue !== '' && policyValues.includes(policyValue)) {
        issues.push({
          path: `${base}.value`,
          message: t('uiConfig.duplicate', { value: policyValue }),
        });
        return;
      }
      if (policyValue !== '') policyValues.push(policyValue);
    });
  }

  const defaults = raw['defaults'];
  if (!isRecord(defaults)) {
    issues.push({ path: 'defaults', message: t('uiConfig.mustBeObject') });
  } else {
    const ruleType = defaults['ruleType'];
    if (typeof ruleType !== 'string' || ruleType.trim() === '') {
      issues.push({ path: 'defaults.ruleType', message: t('uiConfig.defaultRuleTypeEmpty') });
    } else if (!ruleTypeValues.includes(ruleType.trim())) {
      issues.push({
        path: 'defaults.ruleType',
        message: t('uiConfig.notInRuleTypes', { value: ruleType.trim() }),
      });
    }
    const policy = defaults['policy'];
    if (typeof policy !== 'string' || policy.trim() === '') {
      issues.push({ path: 'defaults.policy', message: t('uiConfig.defaultPolicyEmpty') });
    } else if (!policyValues.includes(policy.trim())) {
      issues.push({
        path: 'defaults.policy',
        message: t('uiConfig.notInPolicies', { value: policy.trim() }),
      });
    }
  }

  const failed = raw['failedConnections'];
  if (!isRecord(failed)) {
    issues.push({ path: 'failedConnections', message: t('uiConfig.mustBeObject') });
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
    issues.push({ path: 'settings', message: t('uiConfig.mustBeObject') });
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
  language: 'zh',
  ruleTypes: ['DOMAIN', 'DOMAIN-SUFFIX'],
  policies: [
    { value: 'PROXY', label: '代理' },
    { value: 'DIRECT', label: '直连' },
  ],
  defaults: { ruleType: 'DOMAIN', policy: 'PROXY' },
  failedConnections: { refetchIntervalMs: 5000, lines: 5000 },
  settings: { logsRefetchIntervalMs: 5000 },
};

/** 文件级校验：界面常量 + 可选的 rules 段（类型要在 ruleTypes 白名单里）。 */
function uiConfigFileIssues(raw: unknown): UiConfigIssue[] {
  const issues = uiConfigIssues(raw);
  if (!isRecord(raw)) return issues;

  const core = raw['core'];
  if (isRecord(core)) {
    const binaryPath = core['binaryPath'];
    if (binaryPath !== undefined && (typeof binaryPath !== 'string' || binaryPath.trim() === '')) {
      issues.push({ path: 'core.binaryPath', message: t('uiConfig.notEmpty') });
    }
    const mixedPort = core['mixedPort'];
    if (
      mixedPort !== undefined &&
      (typeof mixedPort !== 'number' ||
        !Number.isInteger(mixedPort) ||
        mixedPort < 1 ||
        mixedPort > 65535)
    ) {
      issues.push({
        path: 'core.mixedPort',
        message: t('uiConfig.outOfRange', { min: 1, max: 65535 }),
      });
    }
  } else if (core !== undefined) {
    issues.push({ path: 'core', message: t('uiConfig.mustBeObject') });
  }

  const rules = raw['rules'];
  if (rules === undefined) return issues;
  if (!Array.isArray(rules)) {
    issues.push({ path: 'rules', message: t('uiConfig.mustBeArray') });
    return issues;
  }

  const ruleTypes = Array.isArray(raw['ruleTypes'])
    ? raw['ruleTypes'].filter((value): value is string => typeof value === 'string')
    : [];

  rules.forEach((entry, index) => {
    const path = `rules[${String(index)}]`;
    if (!isRecord(entry)) {
      issues.push({ path, message: t('uiConfig.mustBeObject') });
      return;
    }
    const type = entry['type'];
    if (typeof type !== 'string' || !ruleTypes.includes(type)) {
      issues.push({
        path: `${path}.type`,
        message: t('uiConfig.notInRuleTypes', { value: String(type) }),
      });
    }
    for (const key of ['value', 'policy'] as const) {
      const text = entry[key];
      if (typeof text !== 'string' || text.trim() === '') {
        issues.push({ path: `${path}.${key}`, message: t('uiConfig.notEmpty') });
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

export function uiConfigPath(dataDir: string): string {
  return path.join(dataDir, 'config.json');
}

let active: UiConfig = DEFAULT_UI_CONFIG;

/** 当前生效的界面常量。 */
export function getUiConfig(): UiConfig {
  return active;
}

/** 更新内存中的生效值（调用方负责写回文件），语言跟着配置一起生效。 */
export function setActiveUiConfig(config: UiConfig): UiConfig {
  active = config;
  setLanguage(config.language);
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
    throw new Error(t('uiConfig.fileMissing', { file }));
  }
  if (text.trim() === '') {
    throw new Error(t('uiConfig.fileEmpty', { file }));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      t('uiConfig.fileNotJson', {
        file,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  try {
    return parseUiConfigFile(raw);
  } catch (error) {
    if (error instanceof UiConfigValidationError) {
      throw new UiConfigValidationError(error.issues, t('uiConfig.fileInvalid', { file }));
    }
    throw error;
  }
}
