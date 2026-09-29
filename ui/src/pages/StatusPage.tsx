/** 状态页：内核状态、端口、订阅信息、系统代理三项状态、重启内核。计划 §8。 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import NoticeStack from '../components/NoticeStack';
import Notice from '../components/Notice';
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
  const recover = useAction(
    queryClient,
    notices.push,
    api.recover,
    (result) => `一键修复：${result.steps.join('；')}`,
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
          <h2 className="text-base font-semibold">内核</h2>
          <span className="text-xs text-slate-500">
            {data === undefined ? '读取中…' : (STATE_TEXT[data.kernel.state] ?? data.kernel.state)}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              disabled={busy}
              onClick={() => recover.mutate()}
              title="重写配置 → 启动内核 → 开系统代理"
            >
              一键修复
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy || kernelUp}
              onClick={() => startKernel.mutate()}
              title="启动后自动开启系统代理"
            >
              启动内核
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={busy || !kernelUp}
              onClick={() => stopKernel.mutate()}
              title="停止后自动关闭系统代理"
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
            {data?.proxy.guarding === true ? '已开启（守护中，每 60 s 巡检）' : '已关闭（未守护）'}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              disabled={busy}
              onClick={() => enableProxy.mutate()}
              title="开启并纳入守护"
            >
              开启系统代理
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
              disabled={busy}
              onClick={() => disableProxy.mutate()}
              title="关闭并停止守护"
            >
              关闭系统代理
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
            与实际值不一致，最坏 60 s 内会被守护回写；点一下"开启系统代理"也会立刻重写一遍。
          </p>
        )}
        {data?.proxy.error != null && (
          <p className="mt-1 text-xs text-rose-700">{data.proxy.error}</p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          开关与守护捆绑：开启系统代理即纳入守护，关闭系统代理即停止守护，没有单独的守护开关。
          内核就绪时会自动走到开启这一侧，内核停止则自动关闭。
        </p>
      </section>

      <section className="rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">退出应用</h2>
          <div className="ml-auto">
            <button
              type="button"
              className="rounded border border-rose-300 px-2 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              disabled={quitting}
              onClick={() => {
                if (quitSafely === undefined) {
                  notices.push(
                    'warn',
                    '当前不在应用内运行，无法从界面退出；请用托盘菜单的「安全退出」。',
                  );
                  return;
                }
                if (!window.confirm('退出前会先关闭系统代理并停止内核，确定退出？')) return;
                setQuitting(true);
                void quitSafely().catch((error: unknown) => {
                  setQuitting(false);
                  notices.push('error', String(error));
                });
              }}
            >
              {quitting ? '正在安全关闭…' : '安全关闭应用'}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          退出请只用这个按钮或托盘菜单的「安全退出」：顺序是先关闭系统代理、再停止内核。
          从任务管理器结束进程、或在终端按 Ctrl+C 会跳过这一步（Windows 强杀无法被捕获），
          系统代理会残留指向已经停掉的内核端口。真遇到了就点「关闭系统代理」或「一键修复」恢复。
        </p>
      </section>

      <p
        className="text-xs text-slate-500"
        onMouseEnter={() => setDirHintOpen(true)}
        onFocus={() => setDirHintOpen(true)}
      >
        数据目录：{data?.app.dataDir ?? '—'}
      </p>
      {dirHintOpen && data?.app.dataFallback === true && (
        <Notice kind="warn" text={`程序目录不可写，数据实际存放在 ${data.app.dataDir}`} />
      )}
    </div>
  );
}
