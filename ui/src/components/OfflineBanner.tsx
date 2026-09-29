/**
 * 离线兜底条：后端 5xx 或完全不响应时出现，恢复后自动消失。
 * 两个按钮就是"关掉一切"和"再来一次"：进程间调用主进程执行（浏览器里退回 HTTP）。
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { setOffline, useOffline } from '../lib/offline';

type OfflineAction = 'shutdown' | 'restart';

function offlineBridge(): { action(name: OfflineAction): Promise<unknown> } | undefined {
  return (window as unknown as { mcpOffline?: { action(name: OfflineAction): Promise<unknown> } })
    .mcpOffline;
}

export default function OfflineBanner() {
  const offline = useOffline();
  const [busy, setBusy] = useState<OfflineAction | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 离线期间每秒问候一次，通了就解除离线状态
  useEffect(() => {
    if (!offline) return;
    let stopped = false;

    const greet = async (): Promise<void> => {
      try {
        await api.ping();
        if (!stopped) {
          setNote(null);
          setOffline(false);
        }
      } catch {
        // 还没活过来，等下一秒
      }
    };

    void greet();
    const timer = setInterval(() => void greet(), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [offline]);

  if (!offline) return null;

  const run = async (action: OfflineAction): Promise<void> => {
    setBusy(action);
    setNote(null);
    try {
      const bridge = offlineBridge();
      let fallback: string[] | null = null;
      if (bridge !== undefined) {
        const result = await bridge.action(action);
        const details = (result as { fallback?: unknown } | null)?.fallback;
        fallback = Array.isArray(details) ? details.map((step) => String(step)) : null;
      } else if (action === 'shutdown') {
        await api.offlineShutdown();
      } else {
        await api.offlineRestart();
      }
      setNote(
        fallback === null
          ? action === 'shutdown'
            ? '已发起：关闭系统代理并停止内核'
            : '已发起：写入系统代理期望值并重启内核'
          : `后端调不动，已走最后手段：${fallback.join('；')}`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-b-4 border-rose-700 bg-rose-600 px-4 py-3 text-white shadow-lg">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-bold">离线：后端无响应</span>
        <span className="text-xs">每秒重试一次，通了会自动恢复</span>
        <div className="ml-auto flex gap-3">
          <button
            type="button"
            className="rounded bg-white px-5 py-2 text-base font-bold text-rose-700 shadow hover:bg-rose-50 disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => void run('shutdown')}
          >
            {busy === 'shutdown' ? '处理中…' : '完全关闭代理'}
          </button>
          <button
            type="button"
            className="rounded bg-amber-300 px-5 py-2 text-base font-bold text-slate-900 shadow hover:bg-amber-200 disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => void run('restart')}
          >
            {busy === 'restart' ? '处理中…' : '立即重启内核'}
          </button>
        </div>
      </div>
      {note !== null && <p className="mt-1 text-xs">{note}</p>}
    </div>
  );
}
