/**
 * 规则增删改查，写操作走事务。
 * 计划 §5.3 规则存储。
 */
import type { RulesDatabase } from './db.js';

export interface Rule {
  id: number;
  position: number;
  enabled: boolean;
  type: string;
  value: string;
  policy: string;
  noResolve: boolean;
}

export type RuleInput = Omit<Rule, 'id' | 'position'>;

export interface RuleRepo {
  list(): Rule[];
  create(inputs: RuleInput[]): Rule[];
  update(id: number, input: Partial<RuleInput>): Rule;
  remove(id: number): void;
  reorder(ids: number[]): void;
}

export function createRuleRepo(_db: RulesDatabase): RuleRepo {
  throw new Error('未实现：规则增删改查');
}
