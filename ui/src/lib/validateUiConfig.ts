/**
 * 界面侧的取值检测：规则必须与后端 src/ui-config.ts 的 uiConfigIssues() 完全一致。
 * tests/ui/ui-config-validation.test.ts 用同一批用例对拍两端结果。
 */

export interface UiConfigIssue {
  path: string;
  message: string;
}

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
