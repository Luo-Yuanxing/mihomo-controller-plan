/** 状态页：内核状态、端口、订阅信息、系统代理三项状态、重启内核。计划 §8。 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import NoticeStack from '../components/NoticeStack';
import { api } from '../lib/api';
import type { ProxyValues } from '../lib/types';
import { useNotices, type NoticeKind } from '../lib/useNotices';

const STATE_TEXT: Record<string, string> = {
  running: '运行中',
  adopted: '已接管',
  stopped: '未运行',
  failed: '异常',
};

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
  if (values === null) return '读不到';
  const value = values[key];
  return typeof value === 'boolean' ? (value ? '1' : '0') : value;
}

export default function StatusPage() {
  const queryClient = useQueryClient();
  const notices = useNotices();
  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 5000,
  });

  const restart = useAction(
    queryClient,
    notices.push,
    api.restartKernel,
    (status) => `内核状态：${status.state}`,
  );
  const startKernel = useAction(queryClient, notices.push, api.startKernel, (status) =>
    status.state === 'failed' ? `启动失败：${status.error ?? '未知原因'}` : '内核已启动',
  );
  const stopKernel = useAction(queryClient, notices.push, api.stopKernel, () => '内核已停止');
  const refresh = useAction(
    queryClient,
    notices.push,
    api.refreshSubscription,
    () => '订阅已更新并通知内核重载',
  );
  const removeSubscription = useMutation({
    mutationFn: api.deleteSubscription,
    onSuccess: async (result) => {
      notices.push(
        result.kernel.state === 'failed' ? 'error' : 'ok',
        result.kernel.state === 'failed'
          ? `订阅已删除，但内核重启失败：${result.kernel.error ?? '未知原因'}`
          : '订阅已删除，网络已切换为直连',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['status'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['logs'] }),
      ]);
    },
    onError: (error: Error) => notices.push('error', error.message),
  });
  const enableProxy = useAction(queryClient, notices.push, api.enableProxy, () => '系统代理已开启');
  const disableProxy = useAction(
    queryClient,
    notices.push,
    api.disableProxy,
    () => '系统代理已关闭',
  );
  const applyProxy = useAction(queryClient, notices.push, api.applyProxy, () => '系统代理写入成功');

  const data = statusQuery.data;
  const busy =
    restart.isPending ||
    startKernel.isPending ||
    stopKernel.isPending ||
    refresh.isPending ||
    removeSubscription.isPending ||
    enableProxy.isPending ||
    disableProxy.isPending;
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
          <h2 className="text-base font-semibold">内核</h2>
          <span className="text-xs text-slate-500">
            {data === undefined ? '读取中…' : (STATE_TEXT[data.kernel.state] ?? data.kernel.state)}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy || kernelUp}
              onClick={() => startKernel.mutate()}
            >
              启动内核
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy || !kernelUp}
              onClick={() => stopKernel.mutate()}
            >
              停止内核
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => restart.mutate()}
            >
              重启内核
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-slate-500">版本</dt>
            <dd>{data?.kernel.version ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">PID</dt>
            <dd>{data?.kernel.pid ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">控制端口</dt>
            <dd className="font-mono">{data?.kernel.controller ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">混合端口</dt>
            <dd>{data?.kernel.mixedPort ?? '—'}</dd>
          </div>
          <div className="col-span-2 flex gap-2">
            <dt className="text-slate-500">内核路径</dt>
            <dd className="break-all font-mono text-xs">{data?.kernel.binaryPath ?? '—'}</dd>
          </div>
          {data?.kernel.error != null && (
            <div className="col-span-2 text-rose-700">错误：{data.kernel.error}</div>
          )}
        </dl>
      </section>

      <section className="rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">订阅</h2>
          <span className="text-xs text-slate-500">
            {data?.subscription.refreshing === true ? '刷新中…' : ''}
          </span>
          <button
            type="button"
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
            disabled={busy}
            onClick={() => refresh.mutate()}
          >
            刷新订阅
          </button>
          <button
            type="button"
            className="rounded border border-rose-300 px-2 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            disabled={
              busy || (data?.subscription.fileExists !== true && data?.subscription.url === '')
            }
            onClick={() => {
              if (!window.confirm('删除订阅文件并将网络切换为直连？')) return;
              removeSubscription.mutate();
            }}
          >
            删除订阅
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="col-span-2 flex gap-2">
            <dt className="text-slate-500">URL</dt>
            <dd className="break-all font-mono text-xs">{data?.subscription.url || '未配置'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">订阅文件</dt>
            <dd>{data?.subscription.fileExists === true ? '已存在' : '未配置'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">下载走代理</dt>
            <dd>{data?.subscription.useProxy === true ? '是' : '否'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">最近成功</dt>
            <dd>{data?.subscription.lastOkAt ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">大小</dt>
            <dd>{data?.subscription.bytes ?? '—'}</dd>
          </div>
          {data?.subscription.lastError != null && (
            <div className="col-span-2 text-rose-700">最近错误：{data.subscription.lastError}</div>
          )}
        </dl>
      </section>

      <section className="rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">系统代理</h2>
          <span className="text-xs text-slate-500">
            {data?.proxy.guarding === true ? '守护中（每 60 s 巡检）' : '未接管'}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              disabled={busy}
              onClick={() => enableProxy.mutate()}
            >
              开启守护模式
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              disabled={busy}
              onClick={() => applyProxy.mutate()}
            >
              立即写入
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              disabled={busy}
              onClick={() => disableProxy.mutate()}
            >
              关闭
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1">项目</th>
              <th className="px-2 py-1">期望值</th>
              <th className="px-2 py-1">注册表实际值</th>
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
          <p className="mt-1 text-xs text-amber-700">
            与实际值不一致，最坏 60 s 内会被守护回写；可点"立即写入"兜底。
          </p>
        )}
        {data?.proxy.error != null && (
          <p className="mt-1 text-xs text-rose-700">{data.proxy.error}</p>
        )}
      </section>

      <p className="text-xs text-slate-500">
        数据目录：{data?.app.dataDir ?? '—'}
        {data?.app.dataFallback === true ? '（回退到 LOCALAPPDATA）' : ''}
      </p>
    </div>
  );
}
