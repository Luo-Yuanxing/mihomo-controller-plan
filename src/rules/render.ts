/**
 * 规则 → rule-provider yaml（behavior: classical）。
 * 计划 §5.4 规则热更新、§7.2 生成的 rule-provider。
 */
import type { Rule } from './repo.js';

export const RULE_TYPES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'IP-CIDR6',
  'GEOIP',
  'RULE-SET',
  'PROCESS-NAME',
  'MATCH',
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

export function renderRuleProvider(_rules: Rule[]): string {
  throw new Error('未实现：渲染 rule-provider yaml');
}
