/** 设置页：内核路径、端口、订阅 URL、导入设置、日志查看。计划 §8。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import NoticeStack from '../components/NoticeStack';
import { api } from '../lib/api';
import { LANGUAGES, setLanguage, type Language } from '../lib/i18n';
import { useLanguage, useT } from '../lib/useI18n';
import type { Settings } from '../lib/types';
import { DEFAULT_UI_CONFIG } from '../lib/types';
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

/** 日志面板轮询间隔：刷新节奏是代码常量，不落 config.json（条数仍可配）。 */
const LOGS_REFETCH_MS = 5000;

export default function SettingsPage() {
  const t = useT();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const uiConfigQuery = useQuery({ queryKey: ['ui-config'], queryFn: api.uiConfig });
  /** 日志行数跟随界面常量：默认 500，可在 config.json 的 settings.logsLines 调整。 */
  const logsLines =
    uiConfigQuery.data?.config.settings.logsLines ?? DEFAULT_UI_CONFIG.settings.logsLines;
  const logsQuery = useQuery({
    queryKey: ['logs', logsLines],
    queryFn: () => api.logs(logsLines),
    refetchInterval: LOGS_REFETCH_MS,
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
      notices.push('ok', result.needsRestart ? t('settings.savedNeedsRestart') : t('common.saved'));
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
      notices.push('ok', t('settings.shareGenerated', { bytes: result.bytes }));
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  /** 字符串导入：解析与套用都在后端，字段不合法时什么都不会变。 */
  const importConfig = useMutation({
    mutationFn: (payload: string) => api.importUiConfig(payload),
    onSuccess: async (result) => {
      const rules =
        result.rules === null
          ? t('settings.rulesUnchanged')
          : t('settings.rulesCount', { count: result.rules.count });
      const warnings =
        result.warnings.length === 0
          ? ''
          : t('settings.importedWarnings', {
              warnings: result.warnings.join(t('common.listSeparator')),
            });
      notices.push('ok', `${t('settings.imported', { rules })}${warnings}`);
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  /** 立即初始化：把初始化标记改成 false，内容不动。 */
  const initializeConfig = useMutation({
    mutationFn: () => api.initializeUiConfig(),
    onSuccess: async () => {
      notices.push('ok', t('settings.initialized'));
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  const applyUiConfig = useMutation({
    mutationFn: () => {
      const config = uiConfigQuery.data?.config;
      if (config === undefined) throw new Error(t('settings.uiConfigUnavailable'));
      return api.applyUiConfig(config);
    },
    onSuccess: async () => {
      notices.push('ok', t('settings.uiConfigSaved'));
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error) => notices.push('error', error.message),
  });

  /** 切语言：先本地生效（界面立刻变），再把 language 写回 config.json；写失败退回原语言。 */
  const changeLanguage = useMutation({
    mutationFn: (input: { next: Language; previous: Language }) => {
      const config = uiConfigQuery.data?.config;
      if (config === undefined) throw new Error(t('settings.uiConfigUnavailable'));
      return api.applyUiConfig({ ...config, language: input.next });
    },
    onSuccess: async () => {
      notices.push('ok', t('settings.languageSaved'));
      await queryClient.invalidateQueries({ queryKey: ['ui-config'] });
    },
    onError: (error: Error, input) => {
      setLanguage(input.previous);
      notices.push('error', error.message);
    },
  });

  if (draft === null) {
    return <p className="text-sm text-slate-500">{t('settings.loading')}</p>;
  }

  function patch(next: Partial<Settings>): void {
    setDraft((current) => (current === null ? current : { ...current, ...next }));
  }

  /** 初始化标记遗留为 true 时（旧文件）才需要手动点一下。 */
  const needsSetup = uiConfigQuery.data?.initialized === true;

  // 浏览器碰不到文件系统，前端只能查格式；能不能读到文件由后端保存时判定
  const binaryPath = draft.core.binaryPath.trim();
  const binaryIssue =
    binaryPath === ''
      ? t('settings.binaryEmpty')
      : /[<>"|?*]/.test(binaryPath)
        ? t('settings.binaryInvalidChars')
        : binaryPath.toLowerCase().endsWith('.exe')
          ? null
          : t('settings.binaryNotExe');

  return (
    <div className="flex flex-col gap-3">
      <NoticeStack notices={notices.items} onDismiss={notices.dismiss} />

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <Field label={t('settings.language')}>
          <select
            className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
            value={language}
            disabled={uiConfigQuery.data === undefined || changeLanguage.isPending}
            onChange={(event) => {
              const next = event.target.value as Language;
              const previous = language;
              setLanguage(next);
              changeLanguage.mutate({ next, previous });
            }}
          >
            {LANGUAGES.map((option) => (
              <option key={option} value={option}>
                {option === 'zh' ? t('settings.languageZh') : t('settings.languageEn')}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="flex flex-col gap-2 rounded border border-slate-300 bg-white p-3">
        <h2 className="text-base font-semibold">{t('settings.kernelSection')}</h2>
        <Field label={t('settings.binaryPath')}>
          <input
            className={inputClass}
            value={draft.core.binaryPath}
            onChange={(event) => patch({ core: { ...draft.core, binaryPath: event.target.value } })}
          />
        </Field>
        {binaryIssue !== null && <p className="text-xs text-rose-600">{binaryIssue}</p>}
        <Field label={t('settings.mixedPort')}>
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
        <h2 className="text-base font-semibold">{t('settings.subscriptionSection')}</h2>
        <Field label={t('settings.subscriptionUrl')}>
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
        <Field label={t('settings.useProxy')}>
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
        <h2 className="text-base font-semibold">{t('settings.proxySection')}</h2>
        <Field label={t('settings.proxyOverride')}>
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
        <h2 className="text-base font-semibold">{t('settings.importSection')}</h2>
        <p className="text-xs text-slate-500">
          {t('settings.effectiveValues', {
            types: uiConfigQuery.data?.config.ruleTypes.join(' / ') ?? '—',
            policies:
              uiConfigQuery.data?.config.policies.map((option) => option.label).join(' / ') ?? '—',
            lines: uiConfigQuery.data?.config.failedConnections.lines ?? '—',
          })}
        </p>
        {needsSetup && (
          <p className="text-xs font-medium text-amber-700">{t('settings.needsSetup')}</p>
        )}
        <textarea
          className="h-24 w-full resize-none overflow-x-hidden overflow-y-auto break-all rounded border border-slate-300 px-2 py-1 font-mono text-xs"
          placeholder={t('settings.importPlaceholder')}
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
            {importConfig.isPending ? t('settings.importing') : t('settings.importButton')}
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
            {shareConfig.isPending ? t('settings.generating') : t('settings.shareButton')}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={initializeConfig.isPending || !needsSetup}
            title={t('settings.initializeTitle')}
            onClick={() => {
              notices.clear();
              initializeConfig.mutate();
            }}
          >
            {initializeConfig.isPending
              ? t('settings.initializing')
              : t('settings.initializeButton')}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
            disabled={applyUiConfig.isPending || uiConfigQuery.data === undefined}
            title={t('settings.applyTitle')}
            onClick={() => {
              notices.clear();
              applyUiConfig.mutate();
            }}
          >
            {applyUiConfig.isPending ? t('common.saving') : t('settings.applyButton')}
          </button>
        </div>
        <p className="text-xs text-slate-400">{t('settings.shareNote')}</p>
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
        >
          {saveMutation.isPending ? t('common.saving') : t('settings.saveButton')}
        </button>
      </div>

      <section className="rounded border border-slate-300 bg-white p-3">
        <h2 className="mb-2 text-base font-semibold">
          {t('settings.logsTitle', { lines: String(logsLines) })}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {(['app', 'core'] as const).map((key) => (
            <div key={key}>
              <p className="mb-1 text-xs text-slate-500">
                {key === 'app' ? 'app.log' : 'core.log'}
              </p>
              <pre className="h-56 overflow-auto rounded bg-slate-900 p-2 font-mono text-xs text-slate-100">
                {(logsQuery.data?.[key] ?? []).join('\n') || t('settings.noLogs')}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
