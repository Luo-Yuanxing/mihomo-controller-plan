/**
 * 保存/失败反馈条：显示本次 PUT 的 provider 与耗时，失败直接展示后端原始错误。
 * 固定在滚动容器顶部，滚到页面底部也能看到。
 */
export default function Notice({ kind, text }: { kind: 'ok' | 'error'; text: string }) {
  const style =
    kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : 'border-rose-300 bg-rose-50 text-rose-900';
  return (
    <div className={`sticky top-0 z-20 rounded border px-3 py-2 text-sm shadow-sm ${style}`}>
      {text}
    </div>
  );
}
