/** 设置页：内核路径、端口、订阅 URL 与刷新间隔、系统代理开关、日志查看。计划 §8。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import type { Settings } from '../lib/types';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 text-slate-500">{label}</span>
      {children}
      {hint !== undefined && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass = 'w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const logsQuery = useQuery({
    queryKey: ['logs'],
    queryFn: () => api.logs(200),
    refetchInterval: 5000,
  });

  const [draft, setDraft] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (settingsQuery.data !== undefined) setDraft(settingsQuery.data);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (settings: Settings) => api.saveSettings(settings),
    onSuccess: async (result) => {
      setNotice({
        kind: 'ok',
        text: result.needsRestart
          ? '设置已保存；端口或 secret 变了，需要重启内核才生效'
          : '设置已保存',
      });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (error: Error) => setNotice({ kind: 'error', text: error.message }),
  });

  if (draft === null) {
    return <p className="text-sm text-slate-500">读取设置中…</p>;
  }

  function patch(next: Partial<Settings>): void {
    setDraft((current) => (current === null ? current : { ...current, ...next }));
  }

  return (
    <div className="flex flex-col gap-3">
      {notice !== null && <Notice kind={notice.kind} text={notice.text} />}

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <h2 className="text-base font-semibold">内核</h2>
        <Field label="内核路径" hint="相对路径按应用目录解析">
          <input
            className={inputClass}
            value={draft.core.binaryPath}
            onChange={(event) => patch({ core: { ...draft.core, binaryPath: event.target.value } })}
          />
        </Field>
        <Field label="混合端口">
          <input
            type="number"
            className={inputClass}
            value={draft.core.mixedPort}
            onChange={(event) =>
              patch({ core: { ...draft.core, mixedPort: Number(event.target.value) } })
            }
          />
        </Field>
        <Field label="控制端口">
          <input
            type="number"
            className={inputClass}
            value={draft.core.controllerPort}
            onChange={(event) =>
              patch({ core: { ...draft.core, controllerPort: Number(event.target.value) } })
            }
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <h2 className="text-base font-semibold">订阅</h2>
        <Field label="订阅 URL">
          <input
            className={inputClass}
            value={draft.subscription.url}
            onChange={(event) =>
              patch({ subscription: { ...draft.subscription, url: event.target.value } })
            }
          />
        </Field>
        <Field label="刷新间隔（秒）">
          <input
            type="number"
            className={inputClass}
            value={draft.subscription.interval}
            onChange={(event) =>
              patch({
                subscription: { ...draft.subscription, interval: Number(event.target.value) },
              })
            }
          />
        </Field>
        <Field label="User-Agent">
          <input
            className={inputClass}
            value={draft.subscription.userAgent}
            onChange={(event) =>
              patch({ subscription: { ...draft.subscription, userAgent: event.target.value } })
            }
          />
        </Field>
        <Field label="下载走本机代理">
          <input
            type="checkbox"
            checked={draft.subscription.useProxy}
            onChange={(event) =>
              patch({ subscription: { ...draft.subscription, useProxy: event.target.checked } })
            }
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <h2 className="text-base font-semibold">系统代理期望值</h2>
        <Field label="代理服务器">
          <input
            className={inputClass}
            value={draft.proxy.server}
            onChange={(event) => patch({ proxy: { ...draft.proxy, server: event.target.value } })}
          />
        </Field>
        <Field label="ProxyOverride">
          <input
            className={inputClass}
            value={draft.proxy.override}
            onChange={(event) => patch({ proxy: { ...draft.proxy, override: event.target.value } })}
          />
        </Field>
        <Field label="开启守护">
          <input
            type="checkbox"
            checked={draft.proxy.enabled}
            onChange={(event) =>
              patch({ proxy: { ...draft.proxy, enabled: event.target.checked } })
            }
          />
        </Field>
      </section>

      <div>
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
        >
          {saveMutation.isPending ? '保存中…' : '保存设置'}
        </button>
      </div>

      <section className="rounded border border-slate-300 bg-white p-3">
        <h2 className="mb-2 text-base font-semibold">日志（最近 200 行）</h2>
        <div className="grid grid-cols-2 gap-3">
          {(['app', 'core'] as const).map((key) => (
            <div key={key}>
              <p className="mb-1 text-xs text-slate-500">
                {key === 'app' ? 'app.log' : 'core.log'}
              </p>
              <pre className="h-56 overflow-auto rounded bg-slate-900 p-2 font-mono text-xs text-slate-100">
                {(logsQuery.data?.[key] ?? []).join('\n') || '（暂无日志）'}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
