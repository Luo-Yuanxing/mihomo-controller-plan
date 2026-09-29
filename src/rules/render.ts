/**
 * 规则 → rule-provider yaml（behavior: classical）。
 * 计划 §5.4 规则热更新、§7.2 生成的 rule-provider。
 */
import type { Rule } from './repo.js';
import { getRuleTypes } from '../ui-config.js';

export class RuleValidationError extends Error {
  constructor(
    message: string,
    readonly ruleId: number,
  ) {
    super(`规则 id=${ruleId} 不合法：${message}`);
    this.name = 'RuleValidationError';
  }
}

const SAFE_SCALAR = /^[A-Za-z0-9._/:,*+-]+$/;

function emitScalar(value: string): string {
  if (SAFE_SCALAR.test(value) && !value.startsWith('-') && !value.endsWith(':')) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 单条规则的 mihomo rule 文本；类型白名单来自 data/ui-config.json。 */
export function renderRuleLine(rule: Rule): string {
  if (!getRuleTypes().includes(rule.type)) {
    throw new RuleValidationError(`未知类型 ${rule.type}`, rule.id);
  }
  if (rule.policy.trim() === '') {
    throw new RuleValidationError('目标策略为空', rule.id);
  }
  if (rule.value.trim() === '') {
    throw new RuleValidationError('匹配值为空', rule.id);
  }

  const parts = [rule.type, rule.value, rule.policy];
  if (rule.noResolve) parts.push('no-resolve');
  return parts.map(emitScalar).join(',');
}

/** 渲染 rule-provider 内容（behavior: classical），计划 §7.2。 */
export function renderRuleProvider(rules: Rule[]): string {
  const header = ['# 预览模式'];
  const enabled = rules.filter((rule) => rule.enabled);
  if (enabled.length === 0) return `${[...header, 'payload: []'].join('\n')}\n`;

  const lines = enabled.map((rule) => `  - ${renderRuleLine(rule)}`);
  return `${[...header, 'payload:', ...lines].join('\n')}\n`;
}
