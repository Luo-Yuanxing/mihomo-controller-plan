/** 代理出口：目标策略"代理"指向订阅哪个组、当前走哪个节点。提示统一由页面顶部的 NoticeStack 显示。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/useI18n';
import type { NoticeKind } from '../lib/useNotices';

const SELECTOR_TYPES = new Set(['Selector', 'select']);

/** 时延配色：≤200 ms 绿、>200 ms 黄、没测通红。 */
function delayColor(ms: number | undefined): string {
  if (ms === undefined) return 'text-rose-600';
  return ms <= 200 ? 'text-emerald-600' : 'text-amber-600';
}

export default function ProxyOutlets({ push }: { push: (kind: NoticeKind, text: string) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const groupsQuery = useQuery({
    queryKey: ['proxyGroups'],
    queryFn: api.proxyGroups,
    retry: false,
    refetchInterval: 5000,
  });
  const subGroupsQuery = useQuery({
    queryKey: ['subscription-groups'],
    queryFn: api.subscriptionGroups,
  });
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [node, setNode] = useState('');
  const [delays, setDelays] = useState<Record<string, number> | null>(null);

  const target = groupsQuery.data?.target ?? '';
  const group = groupsQuery.data?.groups.find((item) => item.name === target);
  const proxyGroup = settingsQuery.data?.subscription.proxyGroup ?? '';
  const value = node === '' ? (group?.now ?? '') : node;

  const select = useMutation({
    mutationFn: (name: string) => api.selectProxy(target, name),
    onSuccess: async (result) => {
      push('ok', t('outlets.switched', { group: result.group, now: result.now }));
      setNode('');
      await queryClient.invalidateQueries({ queryKey: ['proxyGroups'] });
    },
    onError: (error: Error) => push('error', error.message),
  });

  const delay = useMutation({
    mutationFn: () => api.groupDelay(target),
    onSuccess: (result) => setDelays(result.delays),
    onError: (error: Error) => push('error', error.message),
  });

  // 成员变了（换了指代的组、订阅刷新）旧时延就作废，回到"没测过"的状态
  const members = group?.all.join('\n') ?? '';
  useEffect(() => setDelays(null), [members]);

  const saveGroup = useMutation({
    mutationFn: (next: string) => {
      const settings = settingsQuery.data;
      if (settings === undefined) throw new Error(t('outlets.settingsUnavailable'));
      return api.saveSettings({
        ...settings,
        subscription: { ...settings.subscription, proxyGroup: next },
      });
    },
    onSuccess: async (result) => {
      push(
        'ok',
        result.groupsRebuilt
          ? t('outlets.savedRebuilt')
          : result.needsRestart
            ? t('outlets.savedNeedsRestart')
            : t('common.saved'),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['proxyGroups'] }),
        queryClient.invalidateQueries({ queryKey: ['status'] }),
      ]);
    },
    onError: (error: Error) => push('error', error.message),
  });

  return (
    <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{t('outlets.title')}</h2>
        <span className="text-xs text-slate-500">{t('outlets.hint')}</span>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 text-slate-500">{t('outlets.proxyGroup')}</span>
        <select
          className="w-72 rounded border border-slate-300 px-1 py-1"
          value={proxyGroup}
          disabled={settingsQuery.data === undefined || saveGroup.isPending}
          onChange={(event) => saveGroup.mutate(event.target.value)}
        >
          <option value="">{t('outlets.allNodes')}</option>
          {proxyGroup !== '' &&
            !(subGroupsQuery.data?.groups ?? []).some((item) => item.name === proxyGroup) && (
              <option value={proxyGroup}>{proxyGroup}</option>
            )}
          {subGroupsQuery.data?.groups.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 text-slate-500">{t('outlets.currentExit')}</span>
        {group === undefined ? (
          <span className="text-slate-500">
            {groupsQuery.isError ? String(groupsQuery.error) : t('outlets.groupsUnavailable')}
          </span>
        ) : (
          <>
            <span className="text-slate-500">{group.now || '—'}</span>
            {!SELECTOR_TYPES.has(group.type) && (
              <span className="text-xs text-slate-500">
                {t('outlets.autoGroup', { type: group.type })}
              </span>
            )}
            <button
              type="button"
              className="ml-auto rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={delay.isPending}
              onClick={() => delay.mutate()}
            >
              {delay.isPending ? t('outlets.delayTesting') : t('outlets.delayTest')}
            </button>
          </>
        )}
      </div>

      {group !== undefined && (
        <div className="flex items-start gap-2">
          <span className="w-28 shrink-0" />
          <div className="grid flex-1 grid-cols-4 gap-1">
            {group.all.map((name) => {
              const active = name === value;
              const ms = delays?.[name];
              const selectable = SELECTOR_TYPES.has(group.type);
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  disabled={!selectable || select.isPending}
                  onClick={() => {
                    setNode(name);
                    select.mutate(name);
                  }}
                  className={`flex w-full items-center justify-between gap-1 rounded border px-2 py-1 text-xs ${
                    active
                      ? 'border-slate-900 bg-slate-100 font-semibold'
                      : 'border-slate-300 bg-white hover:bg-slate-50'
                  } ${selectable ? '' : 'cursor-default'}`}
                >
                  <span className="truncate">{name}</span>
                  {delays !== null && (
                    <span className={`shrink-0 ${delayColor(ms)}`}>
                      {ms === undefined ? t('outlets.timeout') : `${String(ms)} ms`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
