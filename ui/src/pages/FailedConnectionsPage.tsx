/** 失败连接页：从内核日志提取失败目标，多选后批量生成规则。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import {
  POLICY_OPTIONS,
  RULE_TYPES,
  type FailedConnection,
  type RuleInput,
  type RuleType,
} from '../lib/types';

function displayTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? value
    : new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export default function FailedConnectionsPage() {
  const queryClient = useQueryClient();
  const failedQuery = useQuery({
    queryKey: ['failedConnections'],
    queryFn: () => api.failedConnections(),
    refetchInterval: 5000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hostQuery, setHostQuery] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('DOMAIN-SUFFIX');
  const [policy, setPolicy] = useState('PROXY');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const connections = failedQuery.data?.connections ?? [];
  const normalizedQuery = hostQuery.trim().toLowerCase();
  const visibleConnections =
    normalizedQuery === ''
      ? connections
      : connections.filter((connection) => connection.host.toLowerCase().includes(normalizedQuery));
  const selectedRows = visibleConnections.filter((connection) => selected.has(connection.id));
  const allVisibleSelected =
    visibleConnections.length > 0 && selectedRows.length === visibleConnections.length;

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((current) =>
      allVisibleSelected
        ? new Set([...current].filter((id) => !visibleConnections.some((item) => item.id === id)))
        : new Set([...current, ...visibleConnections.map((connection) => connection.id)]),
    );
  }

  const addRules = useMutation({
    mutationFn: async () => {
      const rules: RuleInput[] = selectedRows.map((connection) => ({
        enabled: true,
        type: ruleType,
        value: connection.host,
        policy,
        noResolve: true,
      }));
      const created = await api.createRules(rules);
      try {
        const sync = await api.syncRules();
        return { count: created.created.length, syncError: null, sync };
      } catch (error) {
        return {
          count: created.created.length,
          syncError: error instanceof Error ? error.message : String(error),
          sync: null,
        };
      }
    },
    onSuccess: async (result) => {
      setNotice({
        kind: result.syncError === null ? 'ok' : 'error',
        text:
          result.syncError === null
            ? `已新增 ${String(result.count)} 条规则，热更新耗时 ${String(result.sync?.elapsedMs ?? 0)} ms`
            : `已新增 ${String(result.count)} 条规则，但热更新失败：${result.syncError}`,
      });
      setSelected(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rules'] }),
        queryClient.invalidateQueries({ queryKey: ['ruleProvider'] }),
        queryClient.invalidateQueries({ queryKey: ['status'] }),
      ]);
    },
    onError: (error: Error) => setNotice({ kind: 'error', text: error.message }),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">失败连接（{connections.length} 个目标）</h2>
        <span className="text-sm text-slate-500">已选 {selectedRows.length} 个</span>
        {normalizedQuery !== '' && (
          <span className="text-sm text-slate-500">匹配 {visibleConnections.length} 个</span>
        )}
        <label className="ml-auto flex items-center gap-1 text-sm text-slate-500">
          筛选主机
          <input
            type="search"
            className="w-44 rounded border border-slate-300 px-2 py-1 font-mono text-slate-900"
            placeholder="例如 com"
            value={hostQuery}
            onChange={(event) => setHostQuery(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          规则类型
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
            value={ruleType}
            onChange={(event) => setRuleType(event.target.value as RuleType)}
          >
            {RULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          目标策略
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
            value={policy}
            onChange={(event) => setPolicy(event.target.value)}
          >
            {POLICY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
          disabled={visibleConnections.length === 0}
          onClick={toggleAll}
        >
          {allVisibleSelected ? '取消全选' : '全选'}
        </button>
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={selectedRows.length === 0 || policy.trim() === '' || addRules.isPending}
          onClick={() => {
            setNotice(null);
            addRules.mutate();
          }}
        >
          {addRules.isPending ? '添加中…' : `添加 ${String(selectedRows.length)} 条规则`}
        </button>
      </div>

      {notice !== null && <Notice kind={notice.kind} text={notice.text} />}
      {failedQuery.isError && <Notice kind="error" text={String(failedQuery.error)} />}

      <div className="overflow-auto rounded border border-slate-300 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="w-10 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="全选"
                  checked={connections.length > 0 && selected.size === connections.length}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-2 py-2">协议</th>
              <th className="px-2 py-2">主机</th>
              <th className="px-2 py-2">端口</th>
              <th className="px-2 py-2">失败次数</th>
              <th className="px-2 py-2">最近失败</th>
              <th className="px-2 py-2">错误</th>
            </tr>
          </thead>
          <tbody>
            {visibleConnections.map((connection: FailedConnection) => (
              <tr key={connection.id} className="border-t border-slate-200 align-top">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${connection.host}`}
                    checked={selected.has(connection.id)}
                    onChange={() => toggle(connection.id)}
                  />
                </td>
                <td className="px-2 py-2">{connection.network}</td>
                <td className="px-2 py-2 font-mono">{connection.host}</td>
                <td className="px-2 py-2">{connection.port}</td>
                <td className="px-2 py-2">{connection.count}</td>
                <td className="whitespace-nowrap px-2 py-2 text-slate-500">
                  {displayTime(connection.lastSeen)}
                </td>
                <td className="max-w-2xl px-2 py-2 font-mono text-xs text-rose-700">
                  {connection.error}
                </td>
              </tr>
            ))}
            {visibleConnections.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  {failedQuery.isLoading
                    ? '读取日志中…'
                    : connections.length === 0
                      ? '暂无失败连接'
                      : '无匹配主机'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
