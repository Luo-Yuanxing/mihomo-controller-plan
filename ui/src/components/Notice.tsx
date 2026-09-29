/**
 * 单条提示：显示本次操作的反馈，失败直接展示后端原始错误。
 * 固定在顶部的行为由 NoticeStack 负责（见 useNotices 的存留规则）。
 */
export default function Notice({
  kind,
  text,
  onDismiss,
}: {
  kind: 'ok' | 'error';
  text: string;
  onDismiss?: () => void;
}) {
  const style =
    kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : 'border-rose-300 bg-rose-50 text-rose-900';
  return (
    <div className={`flex items-start gap-2 rounded border px-3 py-2 text-sm shadow-sm ${style}`}>
      <span className="flex-1 break-words whitespace-pre-wrap">{text}</span>
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label="关闭提示"
          className="shrink-0 text-xs opacity-60 hover:opacity-100"
          onClick={onDismiss}
        >
          ✕
        </button>
      )}
    </div>
  );
}
