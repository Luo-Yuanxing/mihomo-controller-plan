/** 失败连接页：从内核日志提取失败目标，多选后批量生成规则或拉黑。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import NoticeStack from '../components/NoticeStack';
import { api } from '../lib/api';
import { locale } from '../lib/i18n';
import { useT } from '../lib/useI18n';
import type { BlacklistChangeResult, FailedConnection, RuleInput } from '../lib/types';
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
  /**
   * 黑名单开关是"本次筛选"的意思：默认按 config.json 的默认位置，用户点一下就只影响这次，
   * 不回写文件（点一下开关就改配置文件太重）；关掉时后端返回未筛选的完整列表。
   */
  const [blacklistQuery, setBlacklistQuery] = useState<boolean | null>(null);
  const filterBlacklist = blacklistQuery ?? uiConfig.blacklist.enabled;

  const failedQuery = useQuery({
    queryKey: ['failedConnections', filterBlacklist],
    queryFn: () => api.failedConnections(uiConfig.failedConnections.lines, !filterBlacklist),
    refetchInterval: FAILED_CONNECTIONS_REFETCH_MS,
  });

  /** 完整黑名单：判定"哪些选中项已经在黑名单里"用它，不吃列表回显的条数上限。 */
  const blacklistQueryResult = useQuery({ queryKey: ['blacklist'], queryFn: api.blacklist });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hostQuery, setHostQuery] = useState('');
  const [ruleType, setRuleType] = useState(uiConfig.defaults.ruleType);
  const [policy, setPolicy] = useState(uiConfig.defaults.policy);
  const notices = useNotices();

  const connections = failedQuery.data?.connections ?? [];
  const hiddenCount = failedQuery.data?.blacklist.hiddenCount ?? 0;
  const blacklistHosts = new Set(blacklistQueryResult.data?.hosts ?? []);
  const normalizedQuery = hostQuery.trim().toLowerCase();
  const visibleConnections =
    normalizedQuery === ''
      ? connections
      : connections.filter((connection) => connection.host.toLowerCase().includes(normalizedQuery));
  const selectedRows = visibleConnections.filter((connection) => selected.has(connection.id));
  const allVisibleSelected =
    visibleConnections.length > 0 && selectedRows.length === visibleConnections.length;
  // 已拉黑的主机是列表里"看不见"的：勾上多条时按主机去重，已经拉黑的直接跳过
  const selectedBlacklistable = [
    ...new Set(selectedRows.map((connection) => connection.host.toLowerCase())),
  ].filter((host) => !blacklistHosts.has(host));
  const selectedBlacklisted = [
    ...new Set(
      selectedRows
        .map((connection) => connection.host.toLowerCase())
        .filter((host) => blacklistHosts.has(host)),
    ),
  ];

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

  /** 黑名单增删共用一条路：拉黑/移出后列表立刻按新口径重取。 */
  const blacklistChange = useMutation({
    mutationFn: (input: { hosts: string[]; remove: boolean }) =>
      input.remove ? api.removeFromBlacklist(input.hosts) : api.addToBlacklist(input.hosts),
    onSuccess: async (result: BlacklistChangeResult, input) => {
      notices.push('ok', blacklistNotice(t, result, input.remove));
      setSelected(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['failedConnections'] }),
        queryClient.invalidateQueries({ queryKey: ['blacklist'] }),
        queryClient.invalidateQueries({ queryKey: ['ui-config'] }),
      ]);
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  function changeBlacklist(hosts: string[], remove: boolean): void {
    notices.clear();
    blacklistChange.mutate({
      hosts: [...new Set(hosts.map((host) => host.toLowerCase()))],
      remove,
    });
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
        <label
          className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600"
          title={t('failed.blacklistToggleTitle')}
        >
          <input
            type="checkbox"
            checked={filterBlacklist}
            onChange={(event) => {
              setBlacklistQuery(event.target.checked);
              notices.clear();
            }}
          />
          {t('failed.blacklistToggle')}
        </label>
        {filterBlacklist && hiddenCount > 0 && (
          <span className="rounded bg-rose-100 px-2 py-0.5 text-sm text-rose-700">
            {t('failed.blacklistHidden', { count: hiddenCount })}
          </span>
        )}
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
          className="rounded border border-rose-300 bg-white px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          disabled={selectedBlacklistable.length === 0 || blacklistChange.isPending}
          aria-label={t('failed.blacklistAdd')}
          onClick={() => {
            changeBlacklist(selectedBlacklistable, false);
          }}
        >
          {t('failed.blacklistAdd')}
          {selectedBlacklistable.length > 0 ? ` (${String(selectedBlacklistable.length)})` : ''}
        </button>
        {selectedBlacklisted.length > 0 && (
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={blacklistChange.isPending}
            onClick={() => {
              changeBlacklist(selectedBlacklisted, true);
            }}
          >
            {t('failed.blacklistRemove')} ({selectedBlacklisted.length})
          </button>
        )}
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
                  checked={allVisibleSelected}
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
            {visibleConnections.map((connection: FailedConnection) => {
              const blacklisted = blacklistHosts.has(connection.host.toLowerCase());
              return (
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
                  <td className="px-2 py-2 font-mono">
                    {connection.host}
                    {blacklisted && (
                      <span className="ml-1 rounded bg-rose-100 px-1 text-xs text-rose-700">
                        {t('failed.blacklistBadge')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">{connection.port}</td>
                  <td className="px-2 py-2">{connection.count}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-500">
                    {displayTime(connection.lastSeen)}
                  </td>
                  <td className="max-w-2xl px-2 py-2 font-mono text-xs text-rose-700">
                    {connection.error}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <button
                      type="button"
                      className="rounded border border-rose-300 bg-white px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      disabled={blacklisted || blacklistChange.isPending}
                      title={
                        blacklisted
                          ? t('failed.blacklistBadge')
                          : t('failed.blacklistRowAction', { host: connection.host })
                      }
                      onClick={() => {
                        changeBlacklist([connection.host], false);
                      }}
                    >
                      {t('failed.blacklistAdd')}
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleConnections.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  {failedQuery.isLoading
                    ? t('common.loading')
                    : connections.length === 0
                      ? hiddenCount > 0
                        ? t('failed.blacklistedAll', { count: hiddenCount })
                        : t('failed.none')
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

/** 黑名单改动结果的提示文案：跳过/没找到的条数一并说明，免得用户以为没生效。 */
function blacklistNotice(
  t: ReturnType<typeof useT>,
  result: BlacklistChangeResult,
  remove: boolean,
): string {
  if (remove) {
    return (
      t('failed.blacklistRemoved', { count: result.removed }) +
      (result.missing > 0 ? t('failed.blacklistRemoveMissing', { count: result.missing }) : '')
    );
  }
  return (
    t('failed.blacklistAdded', { count: result.added }) +
    (result.skipped > 0 ? t('failed.blacklistAddedSkipped', { count: result.skipped }) : '')
  );
}
