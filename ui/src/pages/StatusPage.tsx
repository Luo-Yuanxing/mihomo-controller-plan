/** 状态页：内核状态、端口、订阅信息、系统代理三项状态、重启内核。计划 §8。 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import NoticeStack from '../components/NoticeStack';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import { t, type MessageKey } from '../lib/i18n';
import { useT } from '../lib/useI18n';
import type { ProxyValues } from '../lib/types';
import { useNotices, type NoticeKind } from '../lib/useNotices';

const STATE_TEXT: Record<string, MessageKey> = {
  running: 'status.stateRunning',
  adopted: 'status.stateAdopted',
  stopped: 'status.stateStopped',
  failed: 'status.stateFailed',
};

function stateText(state: string): string {
  const key = STATE_TEXT[state];
  return key === undefined ? state : t(key);
}

function useAction<T>(
  queryClient: QueryClient,
  push: (kind: NoticeKind, text: string) => void,
  action: () => Promise<T>,
  okText: (result: T) => string,
) {
  return useMutation({
    mutationFn: action,
    onSuccess: async (result) => {
      push('ok', okText(result));
      await queryClient.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (error: Error) => push('error', error.message),
  });
}

/** 注册表三项逐条对比；enable 显示 1/0，与注册表里的值一致。 */
const PROXY_ROWS: { label: string; key: keyof ProxyValues }[] = [
  { label: 'ProxyEnable', key: 'enable' },
  { label: 'ProxyServer', key: 'server' },
  { label: 'ProxyOverride', key: 'override' },
];

function proxyValue(values: ProxyValues | null, key: keyof ProxyValues): string {
  if (values === null) return t('status.unreadable');
  const value = values[key];
  return typeof value === 'boolean' ? (value ? '1' : '0') : value;
}

export default function StatusPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const notices = useNotices();
  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 5000,
  });

  const restart = useAction(queryClient, notices.push, api.restartKernel, (status) =>
    t('status.kernelState', { state: status.state }),
  );
  const startKernel = useAction(queryClient, notices.push, api.startKernel, (status) =>
    status.state === 'failed'
      ? t('status.startFailed', { error: status.error ?? t('common.unknownReason') })
      : t('status.kernelStarted'),
  );
  const stopKernel = useAction(queryClient, notices.push, api.stopKernel, () =>
    t('status.kernelStopped'),
  );
  const refresh = useAction(queryClient, notices.push, api.refreshSubscription, () =>
    t('status.subscriptionRefreshed'),
  );
  const removeSubscription = useMutation({
    mutationFn: api.deleteSubscription,
    onSuccess: async (result) => {
      notices.push(
        result.kernel.state === 'failed' ? 'error' : 'ok',
        result.kernel.state === 'failed'
          ? t('status.subscriptionDeletedRestartFailed', {
              error: result.kernel.error ?? t('common.unknownReason'),
            })
          : t('status.subscriptionDeleted'),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['status'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['logs'] }),
      ]);
    },
    onError: (error: Error) => notices.push('error', error.message),
  });
  const enableProxy = useAction(queryClient, notices.push, api.enableProxy, () =>
    t('status.proxyEnabled'),
  );
  const disableProxy = useAction(queryClient, notices.push, api.disableProxy, () =>
    t('status.proxyDisabled'),
  );
  const recover = useAction(queryClient, notices.push, api.recover, (result) =>
    t('status.recovered', { steps: result.steps.join(t('common.listSeparator')) }),
  );

  /** 界面跑在 Electron 里时由壳执行安全关闭（先关代理、停内核，再退出）；浏览器里没有这个能力。 */
  const quitSafely = (window as unknown as { mcpApp?: { quitSafely(): Promise<boolean> } }).mcpApp
    ?.quitSafely;
  const [quitting, setQuitting] = useState(false);

  const data = statusQuery.data;
  // 数据目录提示：悬停在数据目录行上时显示，10 s 后自动消失
  const [dirHintOpen, setDirHintOpen] = useState(false);
  useEffect(() => {
    if (!dirHintOpen) return;
    const timer = setTimeout(() => setDirHintOpen(false), 10_000);
    return () => clearTimeout(timer);
  }, [dirHintOpen]);
  const busy =
    restart.isPending ||
    startKernel.isPending ||
    stopKernel.isPending ||
    refresh.isPending ||
    removeSubscription.isPending ||
    enableProxy.isPending ||
    disableProxy.isPending ||
    recover.isPending;
  const kernelState = data?.kernel.state ?? 'stopped';
  const kernelUp = kernelState === 'running' || kernelState === 'adopted';

  return (
    <div className="flex flex-col gap-3">
      <NoticeStack
        notices={[
          ...notices.items,
          ...(statusQuery.isError
            ? [{ id: -1, kind: 'error' as const, text: String(statusQuery.error) }]
            : []),
        ]}
        onDismiss={notices.dismiss}
      />

      <section className="rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">{t('status.kernelSection')}</h2>
          <span className="text-xs text-slate-500">
            {data === undefined ? t('common.loading') : stateText(data.kernel.state)}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              disabled={busy}
              onClick={() => recover.mutate()}
              title={t('status.recoverTitle')}
            >
              {t('status.recover')}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy || kernelUp}
              onClick={() => startKernel.mutate()}
              title={t('status.startKernelTitle')}
            >
              {t('status.startKernel')}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy || !kernelUp}
              onClick={() => stopKernel.mutate()}
              title={t('status.stopKernelTitle')}
            >
              {t('status.stopKernel')}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => restart.mutate()}
            >
              {t('status.restartKernel')}
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-slate-500">{t('status.labelVersion')}</dt>
            <dd>{data?.kernel.version ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">PID</dt>
            <dd>{data?.kernel.pid ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">{t('status.labelController')}</dt>
            <dd className="font-mono">{data?.kernel.controller ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">{t('status.labelMixedPort')}</dt>
            <dd>{data?.kernel.mixedPort ?? '—'}</dd>
          </div>
          <div className="col-span-2 flex gap-2">
            <dt className="text-slate-500">{t('status.labelBinaryPath')}</dt>
            <dd className="break-all font-mono text-xs">{data?.kernel.binaryPath ?? '—'}</dd>
          </div>
          {data?.kernel.error != null && (
            <div className="col-span-2 text-rose-700">
              {t('status.errorLine', { error: data.kernel.error })}
            </div>
          )}
        </dl>
      </section>

      <section className="rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">{t('status.subscriptionSection')}</h2>
          <span className="text-xs text-slate-500">
            {data?.subscription.refreshing === true ? t('status.refreshing') : ''}
          </span>
          <button
            type="button"
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
            disabled={busy}
            onClick={() => refresh.mutate()}
          >
            {t('status.refreshSubscription')}
          </button>
          <button
            type="button"
            className="rounded border border-rose-300 px-2 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            disabled={
              busy || (data?.subscription.fileExists !== true && data?.subscription.url === '')
            }
            onClick={() => {
              if (!window.confirm(t('status.deleteSubscriptionConfirm'))) return;
              removeSubscription.mutate();
            }}
          >
            {t('status.deleteSubscription')}
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="col-span-2 flex gap-2">
            <dt className="text-slate-500">{t('status.labelUrl')}</dt>
            <dd className="break-all font-mono text-xs">
              {data?.subscription.url || t('common.notConfigured')}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">{t('status.labelSubscriptionFile')}</dt>
            <dd>
              {data?.subscription.fileExists === true
                ? t('status.exists')
                : t('common.notConfigured')}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">{t('status.labelUseProxy')}</dt>
            <dd>{data?.subscription.useProxy === true ? t('common.yes') : t('common.no')}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">{t('status.labelLastOk')}</dt>
            <dd>{data?.subscription.lastOkAt ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">{t('status.labelBytes')}</dt>
            <dd>{data?.subscription.bytes ?? '—'}</dd>
          </div>
          {data?.subscription.lastError != null && (
            <div className="col-span-2 text-rose-700">
              {t('status.lastErrorLine', { error: data.subscription.lastError })}
            </div>
          )}
        </dl>
      </section>

      <section className="rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">{t('status.proxySection')}</h2>
          <span className="text-xs text-slate-500">
            {data?.proxy.guarding === true
              ? t('status.proxyGuardingOn')
              : t('status.proxyGuardingOff')}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              disabled={busy}
              onClick={() => enableProxy.mutate()}
              title={t('status.enableProxyTitle')}
            >
              {t('status.enableProxy')}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              disabled={busy}
              onClick={() => disableProxy.mutate()}
              title={t('status.disableProxyTitle')}
            >
              {t('status.disableProxy')}
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1">{t('status.labelItem')}</th>
              <th className="px-2 py-1">{t('status.labelDesired')}</th>
              <th className="px-2 py-1">{t('status.labelActual')}</th>
            </tr>
          </thead>
          <tbody>
            {PROXY_ROWS.map((row) => (
              <tr key={row.key} className="border-t border-slate-200">
                <td className="px-2 py-1 text-slate-500">{row.label}</td>
                <td className="px-2 py-1 font-mono text-xs">
                  {proxyValue(data?.proxy.desired ?? null, row.key)}
                </td>
                <td className="px-2 py-1 font-mono text-xs">
                  {proxyValue(data?.proxy.actual ?? null, row.key)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data !== undefined && !data.proxy.match && (
          <p className="mt-1 text-xs text-amber-700">{t('status.proxyMismatch')}</p>
        )}
        {data?.proxy.error != null && (
          <p className="mt-1 text-xs text-rose-700">{data.proxy.error}</p>
        )}
        <p className="mt-1 text-xs text-slate-500">{t('status.proxyNote')}</p>
      </section>

      <section className="rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">{t('status.quitSection')}</h2>
          <div className="ml-auto">
            <button
              type="button"
              className="rounded border border-rose-300 px-2 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              disabled={quitting}
              onClick={() => {
                if (quitSafely === undefined) {
                  notices.push('warn', t('status.quitUnavailable'));
                  return;
                }
                if (!window.confirm(t('status.quitConfirm'))) return;
                setQuitting(true);
                void quitSafely().catch((error: unknown) => {
                  setQuitting(false);
                  notices.push('error', String(error));
                });
              }}
            >
              {quitting ? t('status.quitting') : t('status.quit')}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('status.quitNote')}</p>
      </section>

      <p
        className="text-xs text-slate-500"
        onMouseEnter={() => setDirHintOpen(true)}
        onFocus={() => setDirHintOpen(true)}
      >
        {t('status.dataDir', { dir: data?.app.dataDir ?? '—' })}
      </p>
      {dirHintOpen && data?.app.dataFallback === true && (
        <Notice kind="warn" text={t('status.dataFallback', { dir: data.app.dataDir })} />
      )}
    </div>
  );
}
