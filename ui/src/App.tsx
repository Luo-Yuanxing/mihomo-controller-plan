/**
 * 三页外壳：规则 / 状态 / 设置。
 * 计划 §8 界面。
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { useOffline } from './lib/offline';
import OfflineBanner from './components/OfflineBanner';
import FailedConnectionsPage from './pages/FailedConnectionsPage';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';
import StatusPage from './pages/StatusPage';

const TABS = [
  { key: 'rules', label: '规则', render: () => <RulesPage /> },
  { key: 'failed', label: '失败连接', render: () => <FailedConnectionsPage /> },
  { key: 'status', label: '状态', render: () => <StatusPage /> },
  { key: 'settings', label: '设置', render: () => <SettingsPage /> },
] as const;

const STATE_LABEL: Record<string, string> = {
  running: '内核运行中',
  adopted: '已接管现有内核',
  stopped: '内核未运行',
  failed: '内核异常',
};

interface StateMark {
  icon: string;
  className: string;
}

const STATE_UNKNOWN: StateMark = {
  icon: '○',
  className: 'border-slate-400 bg-white text-slate-600',
};

/** 内核状态标记：鲜艳底色 + 图样，一眼能看出是否在运行。 */
const STATE_MARK: Record<string, StateMark> = {
  running: {
    icon: '●',
    className: 'border-emerald-400 bg-emerald-100 text-emerald-800',
  },
  adopted: {
    icon: '◆',
    className: 'border-sky-400 bg-sky-100 text-sky-800',
  },
  stopped: STATE_UNKNOWN,
  failed: {
    icon: '▲',
    className: 'border-rose-400 bg-rose-100 text-rose-800',
  },
};

export default function App() {
  const [active, setActive] = useState<string>('rules');
  const offline = useOffline();
  const current = TABS.find((tab) => tab.key === active) ?? TABS[0];
  const status = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 5000,
  });
  const kernelState = status.data?.kernel.state ?? 'stopped';
  const stateMark = STATE_MARK[kernelState] ?? STATE_UNKNOWN;

  // 一进离线状态就跳到状态页，那里能看到内核与系统代理的实时情况
  useEffect(() => {
    if (offline) setActive('status');
  }, [offline]);

  return (
    <div
      className={`flex h-screen flex-col text-slate-900 ${
        offline ? 'bg-rose-100' : 'bg-slate-100'
      }`}
    >
      <OfflineBanner />
      <header
        className={`flex items-center gap-2 border-b px-4 py-2 ${
          offline ? 'border-rose-300 bg-rose-50' : 'border-slate-300 bg-white'
        }`}
      >
        <span className="text-base font-semibold">代理控制面板</span>
        <nav className="ml-4 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`rounded px-3 py-1 text-sm ${
                active === tab.key ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <span
          className={`ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${stateMark.className}`}
        >
          <span className={kernelState === 'running' ? 'animate-pulse' : ''}>{stateMark.icon}</span>
          {STATUS_HINT(kernelState, status.data?.kernel.error ?? null)}
        </span>
      </header>
      <main className="flex-1 overflow-auto p-4">{current.render()}</main>
    </div>
  );
}

function STATUS_HINT(state: string, error: string | null): string {
  const label = STATE_LABEL[state] ?? state;
  return error === null ? label : `${label}：${error}`;
}
