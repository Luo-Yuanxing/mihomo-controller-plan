/**
 * 三页外壳：规则 / 状态 / 设置。
 * 计划 §8 界面。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { setLanguage, t, type Language, type MessageKey } from './lib/i18n';
import { useLanguage } from './lib/useI18n';
import { useUiConfig } from './lib/uiConfig';
import { useOffline } from './lib/offline';
import OfflineBanner from './components/OfflineBanner';
import FailedConnectionsPage from './pages/FailedConnectionsPage';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';
import StatusPage from './pages/StatusPage';

const TABS = [
  { key: 'rules', label: 'app.tabRules', render: () => <RulesPage /> },
  { key: 'failed', label: 'app.tabFailed', render: () => <FailedConnectionsPage /> },
  { key: 'status', label: 'app.tabStatus', render: () => <StatusPage /> },
  { key: 'settings', label: 'app.tabSettings', render: () => <SettingsPage /> },
] as const;

const STATE_LABEL: Record<string, MessageKey> = {
  running: 'app.kernelRunning',
  adopted: 'app.kernelAdopted',
  stopped: 'app.kernelStopped',
  failed: 'app.kernelFailed',
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

/** Electron 壳的桥：切语言要连托盘菜单与对话框一起换（浏览器里没有这个对象）。 */
function i18nBridge(): { setLanguage(language: Language): void } | undefined {
  return (window as unknown as { mcpI18n?: { setLanguage(language: Language): void } }).mcpI18n;
}

export default function App() {
  const [active, setActive] = useState<string>('rules');
  const queryClient = useQueryClient();
  const offline = useOffline();
  const uiConfig = useUiConfig();
  const language = useLanguage();
  const current = TABS.find((tab) => tab.key === active) ?? TABS[0];
  const status = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 5000,
  });
  const kernelState = status.data?.kernel.state ?? 'stopped';
  const stateMark = STATE_MARK[kernelState] ?? STATE_UNKNOWN;

  // 语言以 config.json 为准（默认中文）：读出来就套到界面上
  useEffect(() => {
    setLanguage(uiConfig.language);
  }, [uiConfig.language]);

  // 语言变了：文档语言、窗口标题与 Electron 托盘菜单一起跟上
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = t('app.title');
    i18nBridge()?.setLanguage(language);
  }, [language]);

  // 初始化在加载时就已完成（标记恒为 false），界面不做引导、不自动跳设置页
  const [resetKey, setResetKey] = useState(0);
  const refresh = useMutation({
    mutationFn: () => queryClient.refetchQueries(),
    onSuccess: () => setResetKey((value) => value + 1),
  });

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
        <span className="text-base font-semibold">{t('app.title')}</span>
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
              {t(tab.label)}
            </button>
          ))}
        </nav>
        <button
          type="button"
          title={t('app.refreshTitle')}
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
          className="ml-auto rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
        >
          {refresh.isPending ? t('app.refreshing') : t('app.refresh')}
        </button>
        <span
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${stateMark.className}`}
        >
          <span className={kernelState === 'running' ? 'animate-pulse' : ''}>{stateMark.icon}</span>
          {kernelStateLabel(kernelState, status.data?.kernel.error ?? null)}
        </span>
      </header>
      <main key={resetKey} className="flex-1 overflow-auto p-4">
        {current.render()}
      </main>
    </div>
  );
}

function kernelStateLabel(state: string, error: string | null): string {
  const key = STATE_LABEL[state];
  const label = key === undefined ? state : t(key);
  return error === null ? label : t('app.stateWithError', { label, error });
}
