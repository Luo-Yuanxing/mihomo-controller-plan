/** 保存/失败反馈条：显示本次 PUT 的 provider 与耗时，失败直接展示后端原始错误。 */
export default function Notice({ kind, text }: { kind: 'ok' | 'error'; text: string }) {
  const style =
    kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : 'border-rose-300 bg-rose-50 text-rose-900';
  return <div className={`rounded border px-3 py-2 text-sm ${style}`}>{text}</div>;
}
