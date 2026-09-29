/** 失败连接页：从内核日志提取失败目标，多选后批量生成规则。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import NoticeStack from '../components/NoticeStack';
import { api } from '../lib/api';
import { locale } from '../lib/i18n';
import { useT } from '../lib/useI18n';
import type { FailedConnection, RuleInput } from '../lib/types';
import { useUiConfig } from '../lib/uiConfig';
import { useNotices } from '../lib/useNotices';

/** 兜底轮询间隔：列表按"上榜即稳"设计，靠短间隔刷新没有意义，60 s 足够。 */
const FAILED_CONNECTIONS_REFETCH_MS = 60000;

function displayTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? value
    : new Date(timestamp).toLocaleString(locale(), { hour12: false });
}

export default function FailedConnectionsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const uiConfig = useUiConfig();
  /**
   * 列表口径是"上榜即稳"：一次失败就留 10 分钟，新目标只往末尾追加，位置不会乱跳。
   * 因此不频繁轮询，兜底间隔是代码常量（不落 config.json）；要立刻看最新状态用"刷新列表"，
   * 新增规则后也会主动失效重取。
   */
  const failedQuery = useQuery({
    queryKey: ['failedConnections'],
    queryFn: () => api.failedConnections(uiConfig.failedConnections.lines),
    refetchInterval: FAILED_CONNECTIONS_REFETCH_MS,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hostQuery, setHostQuery] = useState('');
  const [ruleType, setRuleType] = useState(uiConfig.defaults.ruleType);
  const [policy, setPolicy] = useState(uiConfig.defaults.policy);
  const notices = useNotices();

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
        return { count: created.created.length, skipped: created.skipped, syncError: null, sync };
      } catch (error) {
        return {
          count: created.created.length,
          skipped: created.skipped,
          syncError: error instanceof Error ? error.message : String(error),
          sync: null,
        };
      }
    },
    onSuccess: async (result) => {
      const params = { count: result.count, skipped: result.skipped };
      notices.push(
        result.syncError === null ? 'ok' : 'error',
        result.syncError === null
          ? t('failed.added', { ...params, ms: result.sync?.elapsedMs ?? 0 }) +
              (result.skipped > 0 ? t('failed.skipped', { count: result.skipped }) : '')
          : t('failed.addedSyncFailed', { ...params, error: result.syncError }) +
              (result.skipped > 0 ? t('failed.skipped', { count: result.skipped }) : ''),
      );
      setSelected(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rules'] }),
        queryClient.invalidateQueries({ queryKey: ['status'] }),
      ]);
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">
          {t('failed.heading', { count: connections.length })}
        </h2>
        <span className="text-sm text-slate-500">
          {t('failed.selected', { count: selectedRows.length })}
        </span>
        {normalizedQuery !== '' && (
          <span className="text-sm text-slate-500">
            {t('failed.matched', { count: visibleConnections.length })}
          </span>
        )}
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
          disabled={failedQuery.isFetching}
          onClick={() => {
            void failedQuery.refetch();
          }}
        >
          {t('failed.refresh')}
        </button>
        <label className="ml-auto flex items-center gap-1 text-sm text-slate-500">
          {t('failed.filterHost')}
          <input
            type="search"
            className="w-44 rounded border border-slate-300 px-2 py-1 font-mono text-slate-900"
            placeholder={t('failed.filterHostPlaceholder')}
            value={hostQuery}
            onChange={(event) => setHostQuery(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          {t('failed.ruleType')}
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
            value={ruleType}
            onChange={(event) => setRuleType(event.target.value)}
          >
            {uiConfig.ruleTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          {t('failed.policy')}
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
            value={policy}
            onChange={(event) => setPolicy(event.target.value)}
          >
            {uiConfig.policies.map((option) => (
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
          {allVisibleSelected ? t('failed.deselectAll') : t('failed.selectAll')}
        </button>
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={selectedRows.length === 0 || policy.trim() === '' || addRules.isPending}
          onClick={() => {
            notices.clear();
            addRules.mutate();
          }}
        >
          {addRules.isPending
            ? t('failed.adding')
            : t('failed.add', { count: selectedRows.length })}
        </button>
      </div>

      <NoticeStack
        notices={[
          ...notices.items,
          ...(failedQuery.isError
            ? [{ id: -1, kind: 'error' as const, text: String(failedQuery.error) }]
            : []),
        ]}
        onDismiss={notices.dismiss}
      />

      <div className="overflow-auto rounded border border-slate-300 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="w-10 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label={t('failed.selectAll')}
                  checked={connections.length > 0 && selected.size === connections.length}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-2 py-2">{t('failed.columnNetwork')}</th>
              <th className="px-2 py-2">{t('failed.columnHost')}</th>
              <th className="px-2 py-2">{t('failed.columnPort')}</th>
              <th className="px-2 py-2">{t('failed.columnCount')}</th>
              <th className="px-2 py-2">{t('failed.columnLastSeen')}</th>
              <th className="px-2 py-2">{t('failed.columnError')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleConnections.map((connection: FailedConnection) => (
              <tr key={connection.id} className="border-t border-slate-200 align-top">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={t('failed.selectHost', { host: connection.host })}
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
                    ? t('common.loading')
                    : connections.length === 0
                      ? t('failed.none')
                      : t('failed.noMatch')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
