/**
 * 单条提示：显示本次操作的反馈，失败直接展示后端原始错误。
 * 固定在顶部的行为由 NoticeStack 负责（见 useNotices 的存留规则）。
 */
import type { ReactNode } from 'react';
import type { NoticeKind } from '../lib/useNotices';

const KIND_STYLE: Record<NoticeKind, string> = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  error: 'border-rose-300 bg-rose-50 text-rose-900',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
};

export default function Notice({
  kind,
  text,
  onDismiss,
}: {
  kind: NoticeKind;
  text: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded border px-3 py-2 text-sm shadow-sm ${KIND_STYLE[kind]}`}
    >
      <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">{text}</div>
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
