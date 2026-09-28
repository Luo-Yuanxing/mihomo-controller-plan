/**
 * SQLite 连接与建表，唯一使用数据库的地方。
 * 计划 §5.3 规则存储。
 */
import type BetterSqlite3 from 'better-sqlite3';

export type RulesDatabase = BetterSqlite3.Database;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  position    INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  type        TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  policy      TEXT    NOT NULL,
  no_resolve  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rules_position ON rules(position);
`;

export function openRulesDatabase(_dataDir: string): RulesDatabase {
  throw new Error('未实现：打开 data/rules.db');
}
