/** 规则页：规则表格 + 原始 yaml + 保存并热更新。计划 §8。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Rule, RuleInput, UiConfig } from '../lib/types';
import { useUiConfig } from '../lib/uiConfig';
import { useNotices } from '../lib/useNotices';
import NoticeStack from '../components/NoticeStack';
import ProxyOutlets from '../components/ProxyOutlets';

interface EditableRule extends RuleInput {
  id: number | null;
  key: string;
  dirty: boolean;
}

/** 列表筛选：下拉项用 all 表示不筛选，匹配值为字符串包含匹配。 */
interface RuleFilters {
  enabled: 'all' | 'yes' | 'no';
  type: string;
  value: string;
  policy: string;
}

const EMPTY_FILTERS: RuleFilters = { enabled: 'all', type: 'all', value: '', policy: 'all' };

let keySeed = 0;
function nextKey(): string {
  keySeed += 1;
  return `row-${keySeed}`;
}

function toEditable(rule: Rule): EditableRule {
  return {
    id: rule.id,
    key: nextKey(),
    dirty: false,
    enabled: rule.enabled,
    type: rule.type,
    value: rule.value,
    policy: rule.policy,
    noResolve: rule.noResolve,
  };
}

function emptyRule(config: UiConfig): EditableRule {
  return {
    id: null,
    key: nextKey(),
    dirty: true,
    enabled: true,
    type: config.defaults.ruleType,
    value: '',
    policy: config.defaults.policy,
    noResolve: true,
  };
}

function toInput(row: EditableRule): RuleInput {
  return {
    enabled: row.enabled,
    type: row.type,
    value: row.value,
    policy: row.policy,
    noResolve: row.noResolve,
  };
}

export default function RulesPage() {
  const queryClient = useQueryClient();
  const uiConfig = useUiConfig();
  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: api.rules });
  const providerQuery = useQuery({ queryKey: ['ruleProvider'], queryFn: api.ruleProvider });

  const [rows, setRows] = useState<EditableRule[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [orderDirty, setOrderDirty] = useState(false);
  const [filters, setFilters] = useState<RuleFilters>(EMPTY_FILTERS);
  const notices = useNotices();

  useEffect(() => {
    if (rulesQuery.data === undefined) return;
    setRows(rulesQuery.data.rules.map(toEditable));
    setRemoved([]);
    setOrderDirty(false);
  }, [rulesQuery.data]);

  function patchRow(key: string, patch: Partial<EditableRule>): void {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch, dirty: true } : row)),
    );
  }

  function removeRow(row: EditableRule): void {
    setRows((current) => current.filter((item) => item.key !== row.key));
    if (row.id !== null) setRemoved((current) => [...current, row.id as number]);
    setOrderDirty(true);
  }

  function move(index: number, delta: number): void {
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item === undefined) return current;
      next.splice(target, 0, item);
      return next;
    });
    setOrderDirty(true);
  }

  const allEnabled = rows.length > 0 && rows.every((row) => row.enabled);

  /** 一键全启用/全禁用；和单元格里的勾选一样，改动要靠"保存并热更新"落库。 */
  function toggleAll(): void {
    const next = !allEnabled;
    setRows((current) => current.map((row) => ({ ...row, enabled: next, dirty: true })));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const created = rows.filter((row) => row.id === null);
      const changed = rows.filter((row) => row.id !== null && row.dirty);

      if (created.length > 0) await api.createRules(created.map(toInput));
      for (const row of changed) {
        if (row.id !== null) await api.updateRule(row.id, toInput(row));
      }
      for (const id of removed) await api.deleteRule(id);

      if (orderDirty) {
        const ids = rows.map((row) => row.id).filter((id): id is number => id !== null);
        if (ids.length > 0) await api.reorderRules(ids);
      }

      return api.syncRules();
    },
    onSuccess: async (result) => {
      notices.push(
        'ok',
        `已热更新 ${result.provider}：${
          result.changed ? '文件已重写' : '内容无变化，未触发 PUT'
        }，耗时 ${result.elapsedMs} ms`,
      );
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
      await queryClient.invalidateQueries({ queryKey: ['ruleProvider'] });
      await queryClient.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (error: Error) => {
      notices.push('error', error.message);
    },
  });

  const valueQuery = filters.value.trim().toLowerCase();
  const visibleRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      if (filters.enabled === 'yes' && !row.enabled) return false;
      if (filters.enabled === 'no' && row.enabled) return false;
      if (filters.type !== 'all' && row.type !== filters.type) return false;
      if (filters.policy !== 'all' && row.policy !== filters.policy) return false;
      if (valueQuery !== '' && !row.value.toLowerCase().includes(valueQuery)) return false;
      return true;
    });
  const filtering =
    filters.enabled !== 'all' ||
    filters.type !== 'all' ||
    filters.policy !== 'all' ||
    valueQuery !== '';
  const policyChoices = Array.from(
    new Set([...uiConfig.policies.map((option) => option.value), ...rows.map((row) => row.policy)]),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">
          规则（共 {rows.length} 条{filtering ? `，匹配 ${visibleRows.length} 条` : ''}）
        </h2>
      </div>

      <NoticeStack
        notices={[
          ...notices.items,
          ...(rulesQuery.isError
            ? [{ id: -1, kind: 'error' as const, text: String(rulesQuery.error) }]
            : []),
        ]}
        onDismiss={notices.dismiss}
      />

      <ProxyOutlets push={notices.push} />

      {/* 动作按钮放在代理出口与规则表之间：先看出口，再改规则，最后一起热更新 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setRows((current) => [...current, emptyRule(uiConfig)]);
            setOrderDirty(true);
            setFilters(EMPTY_FILTERS);
          }}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50"
        >
          新增规则
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => {
            notices.clear();
            saveMutation.mutate();
          }}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {saveMutation.isPending ? '保存中…' : '保存并热更新'}
        </button>
      </div>

      {/* 固定 8 行视口：表头两行（约 72 px）+ 8 × 40 px 数据行 ≈ 24.5 rem，超出在容器内滚动 */}
      <div className="max-h-[24.5rem] overflow-auto rounded border border-slate-300 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">
                <button
                  type="button"
                  disabled={rows.length === 0}
                  title={allEnabled ? '全部禁用' : '全部启用'}
                  className={`cursor-pointer uppercase hover:underline disabled:cursor-default disabled:opacity-50 disabled:hover:no-underline ${
                    allEnabled ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                  onClick={toggleAll}
                >
                  {allEnabled ? '启用' : '禁用'}
                </button>
              </th>
              <th className="px-2 py-2">顺序</th>
              <th className="px-2 py-2">类型</th>
              <th className="px-2 py-2">匹配值</th>
              <th className="px-2 py-2">目标策略</th>
              <th className="px-2 py-2">no-resolve</th>
              <th className="px-2 py-2">操作</th>
            </tr>
            <tr className="border-t border-slate-200">
              <th className="px-2 py-1">
                <select
                  aria-label="筛选启用状态"
                  className="w-full rounded border border-slate-300 bg-white px-1 py-1 text-xs normal-case text-slate-900"
                  value={filters.enabled}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      enabled: event.target.value as RuleFilters['enabled'],
                    }))
                  }
                >
                  <option value="all">全部</option>
                  <option value="yes">已启用</option>
                  <option value="no">已停用</option>
                </select>
              </th>
              <th className="px-2 py-1" />
              <th className="px-2 py-1">
                <select
                  aria-label="筛选类型"
                  className="w-40 rounded border border-slate-300 bg-white px-1 py-1 text-xs normal-case text-slate-900"
                  value={filters.type}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, type: event.target.value }))
                  }
                >
                  <option value="all">全部</option>
                  {uiConfig.ruleTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-2 py-1">
                <input
                  type="search"
                  aria-label="筛选匹配值"
                  placeholder="包含字符串"
                  className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs normal-case text-slate-900"
                  value={filters.value}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, value: event.target.value }))
                  }
                />
              </th>
              <th className="px-2 py-1">
                <select
                  aria-label="筛选目标策略"
                  className="w-24 rounded border border-slate-300 bg-white px-1 py-1 text-xs normal-case text-slate-900"
                  value={filters.policy}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, policy: event.target.value }))
                  }
                >
                  <option value="all">全部</option>
                  {policyChoices.map((policy) => (
                    <option key={policy} value={policy}>
                      {policy}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-2 py-1" />
              <th className="px-2 py-1">
                {filtering && (
                  <button
                    type="button"
                    className="text-xs normal-case text-slate-500 hover:text-slate-900"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                  >
                    清除
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }) => (
              <tr key={row.key} className="h-10 border-t border-slate-200">
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) => patchRow(row.key, { enabled: event.target.checked })}
                  />
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    type="button"
                    className="px-1 text-slate-500 hover:text-slate-900"
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="px-1 text-slate-500 hover:text-slate-900"
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  {row.id === null && <span className="ml-1 text-xs text-emerald-600">新</span>}
                </td>
                <td className="px-2 py-1">
                  <select
                    className="w-40 rounded border border-slate-300 px-1 py-1"
                    value={row.type}
                    onChange={(event) => patchRow(row.key, { type: event.target.value })}
                  >
                    {uiConfig.ruleTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                    value={row.value}
                    placeholder="example.com"
                    onChange={(event) => patchRow(row.key, { value: event.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <select
                    className="w-24 rounded border border-slate-300 px-1 py-1"
                    value={row.policy}
                    onChange={(event) => patchRow(row.key, { policy: event.target.value })}
                  >
                    {!uiConfig.policies.some((option) => option.value === row.policy) && (
                      <option value={row.policy}>{row.policy}</option>
                    )}
                    {uiConfig.policies.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={row.noResolve}
                    onChange={(event) => patchRow(row.key, { noResolve: event.target.checked })}
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    className="text-rose-600 hover:underline"
                    onClick={() => removeRow(row)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  {rows.length === 0
                    ? '还没有规则，点"新增规则"添加一条。'
                    : '没有符合筛选条件的规则'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2 text-sm">
          <span className="font-semibold">预览模式</span>
        </div>
        <textarea
          readOnly
          className="h-48 w-full rounded border border-slate-300 bg-white p-2 font-mono text-xs"
          value={providerQuery.data?.yaml ?? ''}
        />
      </div>
    </div>
  );
}
