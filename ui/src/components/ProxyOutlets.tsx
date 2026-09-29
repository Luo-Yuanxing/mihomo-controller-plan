/** 代理出口：目标策略"代理"指向订阅哪个组、当前走哪个节点。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useNotices } from '../lib/useNotices';
import NoticeStack from './NoticeStack';

const SELECTOR_TYPES = new Set(['Selector', 'select']);

export default function ProxyOutlets() {
  const queryClient = useQueryClient();
  const notices = useNotices();
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

  const target = groupsQuery.data?.target ?? '';
  const group = groupsQuery.data?.groups.find((item) => item.name === target);
  const proxyGroup = settingsQuery.data?.subscription.proxyGroup ?? '';
  const value = node === '' ? (group?.now ?? '') : node;

  const select = useMutation({
    mutationFn: (name: string) => api.selectProxy(target, name),
    onSuccess: async (result) => {
      notices.push('ok', `${result.group} 已切到 ${result.now}，新连接立即生效`);
      setNode('');
      await queryClient.invalidateQueries({ queryKey: ['proxyGroups'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

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
      notices.push('ok', result.needsRestart ? '已保存；重启内核后生效' : '已保存');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-groups'] }),
      ]);
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  return (
    <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">代理出口</h2>
        <span className="text-xs text-slate-500">
          目标策略选"代理"的规则走这里；没命中的规则一律直连
        </span>
      </div>
      <NoticeStack notices={notices.items} onDismiss={notices.dismiss} />

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
        <span className="text-xs text-slate-400">改完要重启内核</span>
      </label>

      <div className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 text-slate-500">当前出口</span>
        {group === undefined ? (
          <span className="text-slate-500">
            {groupsQuery.isError ? String(groupsQuery.error) : '内核未运行，读不到代理组'}
          </span>
        ) : SELECTOR_TYPES.has(group.type) ? (
          <>
            <select
              aria-label="代理出口节点"
              className="w-72 rounded border border-slate-300 px-1 py-1"
              value={value}
              onChange={(event) => setNode(event.target.value)}
            >
              {!group.all.includes(value) && <option value={value}>{value}</option>}
              {group.all.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
              disabled={select.isPending || value === group.now}
              onClick={() => select.mutate(value)}
            >
              切换
            </button>
            <span className="text-xs text-slate-500">当前：{group.now || '—'}</span>
          </>
        ) : (
          <span className="text-slate-500">
            {group.type} 组自动选出口，不能手动切换（当前：{group.now || '—'}）
          </span>
        )}
      </div>
    </section>
  );
}
