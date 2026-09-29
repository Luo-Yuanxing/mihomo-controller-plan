/** 代理出口：目标策略"代理"指向订阅哪个组、当前走哪个节点。提示统一由页面顶部的 NoticeStack 显示。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { NoticeKind } from '../lib/useNotices';

const SELECTOR_TYPES = new Set(['Selector', 'select']);

export default function ProxyOutlets({ push }: { push: (kind: NoticeKind, text: string) => void }) {
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
      push('ok', `${result.group} 已切到 ${result.now}，新连接立即生效`);
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
      if (settings === undefined) throw new Error('还没读到设置，稍后再试');
      return api.saveSettings({
        ...settings,
        subscription: { ...settings.subscription, proxyGroup: next },
      });
    },
    onSuccess: async (result) => {
      push('ok', result.needsRestart ? '已保存；重启内核后生效' : '已保存');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-groups'] }),
      ]);
    },
    onError: (error: Error) => push('error', error.message),
  });

  return (
    <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">代理出口</h2>
        <span className="text-xs text-slate-500">
          目标策略选"代理"的规则走这里；没命中的规则一律直连
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 text-slate-500">PROXY 指代</span>
        <select
          className="w-72 rounded border border-slate-300 px-1 py-1"
          value={proxyGroup}
          disabled={settingsQuery.data === undefined || saveGroup.isPending}
          onChange={(event) => saveGroup.mutate(event.target.value)}
        >
          <option value="">订阅全部节点</option>
          {proxyGroup !== '' &&
            !(subGroupsQuery.data?.groups ?? []).some((item) => item.name === proxyGroup) && (
              <option value={proxyGroup}>{proxyGroup}</option>
            )}
          {subGroupsQuery.data?.groups.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}（{item.type} · {item.members} 个成员）
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 text-slate-500">当前出口</span>
        {group === undefined ? (
          <span className="text-slate-500">
            {groupsQuery.isError ? String(groupsQuery.error) : '内核未运行，读不到代理组'}
          </span>
        ) : (
          <>
            <span className="text-slate-500">{group.now || '—'}</span>
            {!SELECTOR_TYPES.has(group.type) && (
              <span className="text-xs text-slate-500">（{group.type} 组自动选出口）</span>
            )}
            <button
              type="button"
              className="ml-auto rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={delay.isPending}
              onClick={() => delay.mutate()}
            >
              {delay.isPending ? '测延迟中…' : '测延迟'}
            </button>
          </>
        )}
      </div>

      {group !== undefined && (
        <div className="flex flex-wrap gap-1">
          {group.all.map((name) => {
            const active = name === value;
            const ms = delays?.[name];
            const selectable = SELECTOR_TYPES.has(group.type);
            return (
              <button
                key={name}
                type="button"
                disabled={!selectable || select.isPending}
                onClick={() => {
                  setNode(name);
                  select.mutate(name);
                }}
                className={`rounded border px-2 py-1 text-xs ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white hover:bg-slate-50'
                } ${selectable ? '' : 'cursor-default'}`}
              >
                {name}
                {delays !== null && (
                  <span className={ms === undefined ? 'ml-1 text-rose-400' : 'ml-1 opacity-70'}>
                    {ms === undefined ? '超时' : `${String(ms)} ms`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
