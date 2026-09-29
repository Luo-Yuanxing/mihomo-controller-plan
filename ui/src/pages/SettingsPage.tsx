/** 设置页：内核路径、端口、订阅 URL、导入设置、日志查看。计划 §8。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import NoticeStack from '../components/NoticeStack';
import { api } from '../lib/api';
import type { Settings } from '../lib/types';
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
  const [shareText, setShareText] = useState('');
  const notices = useNotices();

  useEffect(() => {
    if (settingsQuery.data !== undefined) setDraft(settingsQuery.data);
  }, [settingsQuery.data]);

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

  /** 生成分享串：填进文本框，用户自己复制走。 */
  const shareConfig = useMutation({
    mutationFn: () => api.shareUiConfig(),
    onSuccess: (result) => {
      setShareText(result.payload);
      notices.push('ok', `已生成配置字符串（${String(result.bytes)} 字节），复制即可传给别的面板`);
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  /** 字符串导入：解析与套用都在后端，字段不合法时什么都不会变。 */
  const importConfig = useMutation({
    mutationFn: (payload: string) => api.importUiConfig(payload),
    onSuccess: async (result) => {
      const rules = result.rules === null ? '规则未变' : `规则 ${String(result.rules.count)} 条`;
      notices.push(
        'ok',
        `已导入配置（${rules}）${result.warnings.length === 0 ? '' : `；${result.warnings.join('；')}`}`,
      );
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  /** 立即初始化：把初始化标记改成 false，内容不动。 */
  const initializeConfig = useMutation({
    mutationFn: () => api.initializeUiConfig(),
    onSuccess: async () => {
      notices.push('ok', '已初始化：之后启动直接按 config.json 生效');
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  const applyUiConfig = useMutation({
    mutationFn: () => {
      const config = uiConfigQuery.data?.config;
      if (config === undefined) throw new Error('界面常量还没读出来');
      return api.applyUiConfig(config);
    },
    onSuccess: async () => {
      notices.push('ok', '界面常量已保存到 config.json');
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  if (draft === null) {
    return <p className="text-sm text-slate-500">读取设置中…</p>;
  }

  function patch(next: Partial<Settings>): void {
    setDraft((current) => (current === null ? current : { ...current, ...next }));
  }

  /** 初始化文件（还没配置过）：这一区高亮，引导用户先导入一份配置。 */
  const needsSetup = uiConfigQuery.data?.initialized === true;

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

      <section
        className={`flex flex-col gap-2 rounded border bg-white p-3 ${
          needsSetup ? 'border-2 border-amber-400 ring-2 ring-amber-200' : 'border border-slate-300'
        }`}
      >
        <h2 className="text-base font-semibold">导入设置</h2>
        <p className="text-xs text-slate-500">
          当前生效值：规则类型 {uiConfigQuery.data?.config.ruleTypes.join(' / ') ?? '—'}
          ；目标策略{' '}
          {uiConfigQuery.data?.config.policies.map((option) => option.label).join(' / ') ?? '—'}；
          失败连接 {uiConfigQuery.data?.config.failedConnections.refetchIntervalMs ?? '—'}ms /{' '}
          {uiConfigQuery.data?.config.failedConnections.lines ?? '—'} 行
        </p>
        {needsSetup && (
          <p className="text-xs font-medium text-amber-700">
            这还是初始化配置：请从别处导入一份配置字符串，或直接点"立即初始化"沿用当前内容。
          </p>
        )}
        <textarea
          className="h-24 w-full resize-y rounded border border-slate-300 px-2 py-1 font-mono text-xs"
          placeholder="把别处生成的配置字符串粘到这里，再点“导入字符串”"
          value={shareText}
          onChange={(event) => setShareText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={importConfig.isPending || shareText.trim() === ''}
            onClick={() => {
              notices.clear();
              importConfig.mutate(shareText.trim());
            }}
          >
            {importConfig.isPending ? '导入中…' : '导入字符串'}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={shareConfig.isPending}
            onClick={() => {
              notices.clear();
              shareConfig.mutate();
            }}
          >
            {shareConfig.isPending ? '生成中…' : '生成字符串'}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={initializeConfig.isPending || !needsSetup}
            title="只把初始化标记改成 false，内容不动"
            onClick={() => {
              notices.clear();
              initializeConfig.mutate();
            }}
          >
            {initializeConfig.isPending ? '初始化中…' : '立即初始化'}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={applyUiConfig.isPending || uiConfigQuery.data === undefined}
            title="把上面显示的界面常量写回 config.json"
            onClick={() => {
              notices.clear();
              applyUiConfig.mutate();
            }}
          >
            {applyUiConfig.isPending ? '保存中…' : '保存界面常量'}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          字符串里只有界面常量、自定义规则、内核路径与系统代理期望值；订阅与内核 secret 不外传。
        </p>
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
