/** 规则页：规则表格 + 原始 yaml + 保存并热更新。计划 §8。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import { RULE_TYPES, type Rule, type RuleInput } from '../lib/types';

interface EditableRule extends RuleInput {
  id: number | null;
  key: string;
  dirty: boolean;
}

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

function emptyRule(): EditableRule {
  return {
    id: null,
    key: nextKey(),
    dirty: true,
    enabled: true,
    type: 'DOMAIN-SUFFIX',
    value: '',
    policy: 'PROXY',
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
  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: api.rules });
  const providerQuery = useQuery({ queryKey: ['ruleProvider'], queryFn: api.ruleProvider });

  const [rows, setRows] = useState<EditableRule[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [orderDirty, setOrderDirty] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

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
      setNotice({
        kind: 'ok',
        text: `已热更新 ${result.provider}：${
          result.changed ? '文件已重写' : '内容无变化，未触发 PUT'
        }，耗时 ${result.elapsedMs} ms`,
      });
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
      await queryClient.invalidateQueries({ queryKey: ['ruleProvider'] });
      await queryClient.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (error: Error) => {
      setNotice({ kind: 'error', text: error.message });
    },
  });

  const providerName = rulesQuery.data?.provider ?? 'custom';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">规则（共 {rows.length} 条）</h2>
        <button
          type="button"
          onClick={() => {
            setRows((current) => [...current, emptyRule()]);
            setOrderDirty(true);
          }}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50"
        >
          新增规则
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => {
            setNotice(null);
            saveMutation.mutate();
          }}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {saveMutation.isPending ? '保存中…' : '保存并热更新'}
        </button>
        <span className="text-xs text-slate-500">provider：{providerName}</span>
      </div>

      {notice !== null && <Notice kind={notice.kind} text={notice.text} />}
      {rulesQuery.isError && <Notice kind="error" text={String(rulesQuery.error)} />}

      <div className="overflow-auto rounded border border-slate-300 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">启用</th>
              <th className="px-2 py-2">顺序</th>
              <th className="px-2 py-2">类型</th>
              <th className="px-2 py-2">匹配值</th>
              <th className="px-2 py-2">目标策略</th>
              <th className="px-2 py-2">no-resolve</th>
              <th className="px-2 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} className="border-t border-slate-200">
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
                    {RULE_TYPES.map((type) => (
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
                    placeholder={row.type === 'MATCH' ? '（MATCH 不需要）' : 'example.com'}
                    disabled={row.type === 'MATCH'}
                    onChange={(event) => patchRow(row.key, { value: event.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-40 rounded border border-slate-300 px-2 py-1 font-mono"
                    value={row.policy}
                    onChange={(event) => patchRow(row.key, { policy: event.target.value })}
                  />
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  还没有规则，点"新增规则"添加一条。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2 text-sm">
          <span className="font-semibold">rule-provider 原文</span>
          <span className="text-xs text-slate-500">
            {providerQuery.data?.file ?? ''}
            {providerQuery.data?.exists === false ? '（尚未生成，以下为预览）' : ''}
          </span>
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
