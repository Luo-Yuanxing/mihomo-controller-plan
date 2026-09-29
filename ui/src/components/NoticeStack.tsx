/** 提示条堆叠：整组固定在滚动容器顶部，滚到页面底部也能看到。 */
import type { NoticeItem } from '../lib/useNotices';
import Notice from './Notice';

export default function NoticeStack({
  notices,
  onDismiss,
}: {
  notices: NoticeItem[];
  onDismiss?: (id: number) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="sticky top-0 z-20 flex flex-col gap-1">
      {notices.map((item) => (
        <Notice
          key={item.id}
          kind={item.kind}
          text={item.text}
          {...(onDismiss === undefined ? {} : { onDismiss: () => onDismiss(item.id) })}
        />
      ))}
    </div>
  );
}
