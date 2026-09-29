/**
 * 规则增删改查，写操作走事务。
 * 计划 §5.3 规则存储。
 */
import type { RulesDatabase } from './db.js';
import { t } from '../i18n.js';

export interface Rule {
  id: number;
  position: number;
  enabled: boolean;
  type: string;
  value: string;
  policy: string;
  noResolve: boolean;
}

export interface RuleInput {
  enabled: boolean;
  type: string;
  value: string;
  policy: string;
  noResolve: boolean;
}

export interface RuleRepo {
  list(): Rule[];
  create(inputs: RuleInput[]): Rule[];
  /** 整表覆盖：删掉现有规则，按给定顺序重建（导入配置用）。 */
  replaceAll(inputs: RuleInput[]): Rule[];
  update(id: number, input: Partial<RuleInput>): Rule;
  remove(id: number): void;
  reorder(ids: number[]): void;
}

interface RuleRow {
  id: number;
  position: number;
  enabled: number;
  type: string;
  value: string;
  policy: string;
  no_resolve: number;
}

/**
 * 规则唯一键：类型 + 取值，两者都一样才算重复（大小写不敏感，避免 DOMAIN/domain 各存一条）。
 * 域名大小写等价、规则类型也是枚举，这里统一按小写归一。
 */
export function ruleKey(input: Pick<RuleInput, 'type' | 'value'>): string {
  return `${input.type.trim().toLowerCase()}\u0000${input.value.trim().toLowerCase()}`;
}

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    position: row.position,
    enabled: row.enabled === 1,
    type: row.type,
    value: row.value,
    policy: row.policy,
    noResolve: row.no_resolve === 1,
  };
}

const WRITABLE: ReadonlyArray<keyof RuleInput> = [
  'enabled',
  'type',
  'value',
  'policy',
  'noResolve',
];

export function createRuleRepo(db: RulesDatabase): RuleRepo {
  const selectAll = db.prepare('SELECT * FROM rules ORDER BY position, id');
  const selectOne = db.prepare('SELECT * FROM rules WHERE id = ?');
  const selectMax = db.prepare('SELECT COALESCE(MAX(position), 0) AS max FROM rules');
  const insert = db.prepare(
    `INSERT INTO rules (position, enabled, type, value, policy, no_resolve)
     VALUES (@position, @enabled, @type, @value, @policy, @noResolve)`,
  );
  const updatePosition = db.prepare('UPDATE rules SET position = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM rules WHERE id = ?');

  function list(): Rule[] {
    return (selectAll.all() as RuleRow[]).map(toRule);
  }

  function get(id: number): Rule | null {
    const row = selectOne.get(id) as RuleRow | undefined;
    return row === undefined ? null : toRule(row);
  }

  const insertMany = db.transaction((inputs: RuleInput[]): number[] => {
    let position = (selectMax.get() as { max: number }).max;
    const ids: number[] = [];
    for (const input of inputs) {
      position += 1;
      const info = insert.run({
        position,
        enabled: input.enabled === false ? 0 : 1,
        type: input.type,
        value: input.value,
        policy: input.policy,
        noResolve: input.noResolve === true ? 1 : 0,
      });
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  });

  const reorderMany = db.transaction((ids: number[]): void => {
    const current = list().map((rule) => rule.id);
    const requested = ids.filter((id) => current.includes(id));
    const rest = current.filter((id) => !requested.includes(id));
    [...requested, ...rest].forEach((id, index) => updatePosition.run(index + 1, id));
  });

  const replaceMany = db.transaction((inputs: RuleInput[]): number[] => {
    db.prepare('DELETE FROM rules').run();
    const ids: number[] = [];
    inputs.forEach((input, index) => {
      const info = insert.run({
        position: index + 1,
        enabled: input.enabled === false ? 0 : 1,
        type: input.type,
        value: input.value,
        policy: input.policy,
        noResolve: input.noResolve === true ? 1 : 0,
      });
      ids.push(Number(info.lastInsertRowid));
    });
    return ids;
  });

  return {
    list,
    create(inputs: RuleInput[]): Rule[] {
      const seen = new Set(list().map(ruleKey));
      const fresh: RuleInput[] = [];
      for (const input of inputs) {
        const key = ruleKey(input);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(input);
      }
      const ids = insertMany(fresh);
      return ids.map((id) => get(id)).filter((rule): rule is Rule => rule !== null);
    },
    replaceAll(inputs: RuleInput[]): Rule[] {
      const ids = replaceMany(inputs);
      return ids.map((id) => get(id)).filter((rule): rule is Rule => rule !== null);
    },
    update(id: number, input: Partial<RuleInput>): Rule {
      const patch = Object.entries(input).filter(
        (entry): entry is [keyof RuleInput, RuleInput[keyof RuleInput]] =>
          entry[1] !== undefined && WRITABLE.includes(entry[0] as keyof RuleInput),
      );
      if (patch.length > 0) {
        const columns: Record<string, string> = {
          enabled: 'enabled',
          type: 'type',
          value: 'value',
          policy: 'policy',
          noResolve: 'no_resolve',
        };
        const assignments = patch.map(([key]) => `${columns[key] ?? key} = ?`).join(', ');
        const values = patch.map(([, value]) =>
          typeof value === 'boolean' ? (value ? 1 : 0) : value,
        );
        db.prepare(`UPDATE rules SET ${assignments} WHERE id = ?`).run(...values, id);
      }
      const updated = get(id);
      if (updated === null) throw new Error(t('rules.notFound', { id }));
      return updated;
    },
    remove(id: number): void {
      remove.run(id);
    },
    reorder(ids: number[]): void {
      reorderMany(ids);
    },
  };
}
