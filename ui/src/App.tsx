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
        <span className="ml-auto text-xs text-slate-500">
          {STATUS_HINT(kernelState, status.data?.kernel.error ?? null)}
        </span>
      </header>
      {status.data?.app.dataFallback === true && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-1 text-xs text-amber-900">
          程序目录不可写，数据实际存放在 {status.data.app.dataDir}
        </div>
      )}
      <main className="flex-1 overflow-auto p-4">{current.render()}</main>
    </div>
  );
}

function STATUS_HINT(state: string, error: string | null): string {
  const label = STATE_LABEL[state] ?? state;
  return error === null ? label : `${label}：${error}`;
}
