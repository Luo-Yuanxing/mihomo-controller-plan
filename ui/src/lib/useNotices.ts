/**
 * 页面提示条规则：ok 5 秒后自动消失（可手动关），error 常驻等用户处理，最多同时堆叠 3 条。
 * 新提示覆盖同文案的旧提示（重新计时），超出的先丢最旧的。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** warn 用于常驻的说明性提示（例如数据目录回退），与 error 一样等用户处理。 */
export type NoticeKind = 'ok' | 'error' | 'warn';

export interface NoticeItem {
  id: number;
  kind: NoticeKind;
  text: string;
}

export const OK_NOTICE_TTL_MS = 5000;
export const MAX_NOTICES = 3;

/** 入栈规则（纯函数，便于测试）：同文案同类型只保留最新一条，超出上限丢最旧的。 */
export function appendNotice(current: NoticeItem[], item: NoticeItem): NoticeItem[] {
  const kept = current.filter(
    (existing) => !(existing.kind === item.kind && existing.text === item.text),
  );
  return [...kept, item].slice(-MAX_NOTICES);
}

export interface NoticesApi {
  items: NoticeItem[];
  push(kind: NoticeKind, text: string): void;
  dismiss(id: number): void;
  clear(): void;
}

export function useNotices(): NoticesApi {
  const [items, setItems] = useState<NoticeItem[]>([]);
  const seed = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dropTimer = useCallback((id: number): void => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number): void => {
      dropTimer(id);
      setItems((current) => current.filter((item) => item.id !== id));
    },
    [dropTimer],
  );

  const push = useCallback(
    (kind: NoticeKind, text: string): void => {
      seed.current += 1;
      const id = seed.current;
      setItems((current) => appendNotice(current, { id, kind, text }));
      if (kind === 'ok') {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), OK_NOTICE_TTL_MS),
        );
      }
    },
    [dismiss],
  );

  const clear = useCallback((): void => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setItems([]);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return { items, push, dismiss, clear };
}
