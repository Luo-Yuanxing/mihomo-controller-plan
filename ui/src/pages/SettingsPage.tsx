/** 设置页：内核路径、端口、订阅 URL 与刷新间隔、系统代理开关、日志查看。计划 §8。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import NoticeStack from '../components/NoticeStack';
import { api, ApiError } from '../lib/api';
import type { Settings, UiConfigPreview } from '../lib/types';
import { useNotices } from '../lib/useNotices';
import { uiConfigIssues, type UiConfigIssue } from '../lib/validateUiConfig';

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
  const uiConfigQuery = useQuery({ queryKey: ['ui-config'], queryFn: api.uiConfig });
  const logsQuery = useQuery({
    queryKey: ['logs'],
    queryFn: () => api.logs(200),
    refetchInterval: uiConfigQuery.data?.config.settings.logsRefetchIntervalMs ?? 5000,
  });

  const [draft, setDraft] = useState<Settings | null>(null);
  const [configFile, setConfigFile] = useState('');
  const [preview, setPreview] = useState<UiConfigPreview | null>(null);
  const [valueIssues, setValueIssues] = useState<UiConfigIssue[]>([]);
  const notices = useNotices();

  useEffect(() => {
    if (settingsQuery.data !== undefined) setDraft(settingsQuery.data);
  }, [settingsQuery.data]);

  useEffect(() => {
    if (uiConfigQuery.data !== undefined) setConfigFile(uiConfigQuery.data.file);
  }, [uiConfigQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (settings: Settings) => api.saveSettings(settings),
    onSuccess: async (result) => {
      notices.push(
        'ok',
        result.needsRestart ? '设置已保存；端口或 secret 变了，需要重启内核才生效' : '设置已保存',
      );
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  const forceLoad = useMutation({
    mutationFn: () => api.forceLoadUiConfig(configFile.trim()),
    onSuccess: async (result) => {
      setPreview(null);
      setValueIssues([]);
      notices.push('ok', `已按配置文件强制覆盖系统值：${result.file}`);
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => {
      setValueIssues(error instanceof ApiError ? error.issues : []);
      notices.push('error', error.message);
    },
  });

  const previewLoad = useMutation({
    mutationFn: () => api.previewUiConfig(configFile.trim()),
    onSuccess: (result) => {
      setPreview(result);
      setValueIssues(uiConfigIssues(result.config));
      notices.push(
        'ok',
        result.same
          ? '配置文件与系统值一致，无需保存'
          : '配置文件与系统值不一致（红色项），确认后可一键保存到系统',
      );
    },
    onError: (error: Error) => {
      setPreview(null);
      setValueIssues(error instanceof ApiError ? error.issues : []);
      notices.push('error', error.message);
    },
  });

  const applyUiConfig = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error('先执行预览');
      // 界面侧先自检一次，避免把明显不合法的值发给后端
      const issues = uiConfigIssues(preview.config);
      if (issues.length > 0) throw new ApiError('界面侧取值检测未通过，已阻止保存', issues);
      return api.applyUiConfig({ file: preview.file, config: preview.config });
    },
    onSuccess: async (result) => {
      setPreview(null);
      setValueIssues([]);
      notices.push('ok', `已从界面保存到系统：${result.file}`);
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => {
      setValueIssues(error instanceof ApiError ? error.issues : []);
      notices.push('error', error.message);
    },
  });

  if (draft === null) {
    return <p className="text-sm text-slate-500">读取设置中…</p>;
  }

  function patch(next: Partial<Settings>): void {
    setDraft((current) => (current === null ? current : { ...current, ...next }));
  }

  return (
    <div className="flex flex-col gap-3">
      <NoticeStack notices={notices.items} onDismiss={notices.dismiss} />

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

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <h2 className="text-base font-semibold">界面常量（config.json）</h2>
        <p className="text-xs text-slate-500">
          系统值（存库）：规则类型 {uiConfigQuery.data?.config.ruleTypes.join(' / ') ?? '—'}
          ；目标策略{' '}
          {uiConfigQuery.data?.config.policies.map((option) => option.label).join(' / ') ?? '—'}；
          失败连接 {uiConfigQuery.data?.config.failedConnections.refetchIntervalMs ?? '—'}ms /{' '}
          {uiConfigQuery.data?.config.failedConnections.lines ?? '—'} 行
        </p>
        <Field label="配置文件路径" hint="可放到任意位置">
          <input
            className={inputClass}
            value={configFile}
            onChange={(event) => {
              setConfigFile(event.target.value);
              setPreview(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={previewLoad.isPending || configFile.trim() === ''}
            onClick={() => {
              notices.clear();
              previewLoad.mutate();
            }}
          >
            {previewLoad.isPending ? '读取中…' : '预览加载（只对比）'}
          </button>
          <button
            type="button"
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={forceLoad.isPending || configFile.trim() === ''}
            onClick={() => {
              notices.clear();
              forceLoad.mutate();
            }}
          >
            {forceLoad.isPending ? '覆盖中…' : '强制按配置文件加载（覆盖系统值）'}
          </button>
          {preview !== null && !preview.same && valueIssues.length === 0 && (
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={applyUiConfig.isPending}
              onClick={() => {
                notices.clear();
                applyUiConfig.mutate();
              }}
            >
              {applyUiConfig.isPending ? '保存中…' : '确认保存到系统'}
            </button>
          )}
        </div>

        {valueIssues.length > 0 && (
          <div className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
            <p className="mb-1 font-semibold">
              取值检测未通过（{valueIssues.length} 项），已阻止保存
            </p>
            <ul className="list-disc pl-4">
              {valueIssues.map((issue) => (
                <li key={`${issue.path}-${issue.message}`}>
                  <span className="font-mono">{issue.path === '' ? '配置' : issue.path}</span>：
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview !== null && (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1">字段</th>
                <th className="px-2 py-1">系统值</th>
                <th className="px-2 py-1">配置文件</th>
              </tr>
            </thead>
            <tbody>
              {preview.diff.map((item) => (
                <tr
                  key={item.label}
                  className={
                    item.same ? 'border-t border-slate-100' : 'border-t border-rose-200 bg-rose-50'
                  }
                >
                  <td className="px-2 py-1 text-slate-500">{item.label}</td>
                  <td
                    className={`px-2 py-1 font-mono ${item.same ? 'text-slate-500' : 'text-rose-700'}`}
                  >
                    {item.current}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono ${item.same ? 'text-slate-500' : 'text-rose-700'}`}
                  >
                    {item.incoming}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
