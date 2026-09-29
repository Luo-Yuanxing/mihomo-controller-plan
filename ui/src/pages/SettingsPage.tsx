/** 设置页：内核路径、端口、订阅 URL 与刷新间隔、系统代理开关、日志查看。计划 §8。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import NoticeStack from '../components/NoticeStack';
import { api } from '../lib/api';
import type { Settings, UiConfigPreview } from '../lib/types';
import { useNotices } from '../lib/useNotices';

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

/**
 * 选导出目标路径：Electron 里弹 Windows 保存对话框，默认文件名与目录沿用当前配置文件；
 * 拿不到对话框（浏览器里打开、或主进程还是改动前启动的）时退回输入框里填的路径。
 */
function dialogApi(): { saveJson(path: string): Promise<string | null> } | undefined {
  return (window as unknown as { mcpDialog?: { saveJson(path: string): Promise<string | null> } })
    .mcpDialog;
}

async function pickExportPath(configFile: string): Promise<string | null> {
  const api = dialogApi();
  if (api === undefined) return configFile;

  const dir = configFile.replace(/[\\/][^\\/]*$/, '');
  return api.saveJson(dir === '' ? 'config.json' : `${dir}\\config.json`);
}

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
  const notices = useNotices();

  // 路径格式即时提示（后端仍是最终判定：非空 + .json + 存在且是文件）
  const trimmedConfigFile = configFile.trim();
  const pathIssue =
    trimmedConfigFile === ''
      ? '配置文件路径不能为空'
      : trimmedConfigFile.toLowerCase().endsWith('.json')
        ? null
        : '配置文件必须以 .json 结尾';

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
      notices.push('ok', `已按配置文件强制覆盖生效值：${result.file}`);
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  const previewLoad = useMutation({
    mutationFn: () => api.previewUiConfig(configFile.trim()),
    onSuccess: (result) => {
      setPreview(result);
      notices.push(
        'ok',
        result.same
          ? '配置文件与生效值一致，无需保存'
          : '配置文件与生效值不一致（红色项），确认后可一键保存到 config.json',
      );
    },
    onError: (error: Error) => {
      setPreview(null);
      notices.push('error', error.message);
    },
  });

  const applyUiConfig = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error('先执行预览');
      // 不在前端阻断：合法与否由后端判定
      return api.applyUiConfig({ file: preview.file, config: preview.config });
    },
    onSuccess: async (result) => {
      setPreview(null);
      notices.push('ok', `已保存到 ${result.file}`);
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  /**
   * 导出：先弹 Windows 保存对话框（默认落在配置文件所在文件夹），
   * 再把界面常量 + 自定义规则写成一份 config.json。取消对话框就什么都不做。
   */
  const exportConfig = useMutation({
    mutationFn: async () => {
      const target = await pickExportPath(configFile.trim());
      return target === null ? null : api.exportUiConfig(target);
    },
    onSuccess: (result) => {
      if (result === null) return;
      notices.push(
        'ok',
        dialogApi() === undefined
          ? `已导出到 ${result.file}（含 ${String(result.rules)} 条规则）；当前窗口没有系统保存对话框，路径取自输入框`
          : `已导出到 ${result.file}（含 ${String(result.rules)} 条规则）`,
      );
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  if (draft === null) {
    return <p className="text-sm text-slate-500">读取设置中…</p>;
  }

  function patch(next: Partial<Settings>): void {
    setDraft((current) => (current === null ? current : { ...current, ...next }));
  }

  // 浏览器碰不到文件系统，前端只能查格式；能不能读到文件由后端保存时判定
  const binaryPath = draft.core.binaryPath.trim();
  const binaryIssue =
    binaryPath === ''
      ? '内核路径不能为空'
      : /[<>"|?*]/.test(binaryPath)
        ? '内核路径含非法字符：< > " | ? *'
        : binaryPath.toLowerCase().endsWith('.exe')
          ? null
          : '内核路径必须以 .exe 结尾';

  return (
    <div className="flex flex-col gap-3">
      <NoticeStack notices={notices.items} onDismiss={notices.dismiss} />

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <h2 className="text-base font-semibold">内核</h2>
        <Field label="内核路径">
          <input
            className={inputClass}
            value={draft.core.binaryPath}
            onChange={(event) => patch({ core: { ...draft.core, binaryPath: event.target.value } })}
          />
        </Field>
        {binaryIssue !== null && <p className="text-xs text-rose-600">{binaryIssue}</p>}
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
        <Field label="ProxyOverride">
          <input
            className={inputClass}
            value={draft.proxy.override}
            onChange={(event) => patch({ proxy: { ...draft.proxy, override: event.target.value } })}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <h2 className="text-base font-semibold">界面常量（config.json）</h2>
        <p className="text-xs text-slate-500">
          生效值（config.json）：规则类型 {uiConfigQuery.data?.config.ruleTypes.join(' / ') ?? '—'}
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
        {pathIssue !== null && <p className="text-xs text-rose-700">{pathIssue}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={previewLoad.isPending || pathIssue !== null}
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
            disabled={forceLoad.isPending || pathIssue !== null}
            onClick={() => {
              notices.clear();
              forceLoad.mutate();
            }}
          >
            {forceLoad.isPending ? '覆盖中…' : '强制按配置文件加载（覆盖生效值）'}
          </button>
          {preview !== null && !preview.same && (
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={applyUiConfig.isPending}
              onClick={() => {
                notices.clear();
                applyUiConfig.mutate();
              }}
            >
              {applyUiConfig.isPending ? '保存中…' : '确认保存'}
            </button>
          )}
        </div>

        {preview !== null && (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1">字段</th>
                <th className="px-2 py-1">生效值</th>
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

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
        >
          {saveMutation.isPending ? '保存中…' : '保存设置'}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
          disabled={exportConfig.isPending}
          onClick={() => {
            notices.clear();
            exportConfig.mutate();
          }}
        >
          {exportConfig.isPending ? '导出中…' : '导出到该路径（含规则）'}
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
