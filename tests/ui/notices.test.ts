import { describe, expect, it } from 'vitest';
import {
  appendNotice,
  MAX_NOTICES,
  OK_NOTICE_TTL_MS,
  type NoticeItem,
} from '../../ui/src/lib/useNotices.js';

function item(id: number, kind: NoticeItem['kind'], text: string): NoticeItem {
  return { id, kind, text };
}

describe('提示条入栈规则', () => {
  it('最多堆叠 3 条，超出丢最旧的', () => {
    let items: NoticeItem[] = [];
    for (let i = 1; i <= 5; i++) items = appendNotice(items, item(i, 'error', `e${String(i)}`));

    expect(items).toHaveLength(MAX_NOTICES);
    expect(items.map((entry) => entry.text)).toEqual(['e3', 'e4', 'e5']);
  });

  it('同类型同文案只保留最新一条，并排到末尾', () => {
    const items = appendNotice(
      [item(1, 'ok', '已保存'), item(2, 'error', '失败')],
      item(3, 'ok', '已保存'),
    );

    expect(items.map((entry) => entry.id)).toEqual([2, 3]);
  });

  it('文案相同但类型不同则各自保留', () => {
    const items = appendNotice([item(1, 'ok', '订阅已更新')], item(2, 'error', '订阅已更新'));
    expect(items.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it('ok 提示 5 秒自动消失的时长常量固定', () => {
    expect(OK_NOTICE_TTL_MS).toBe(5000);
  });
});
