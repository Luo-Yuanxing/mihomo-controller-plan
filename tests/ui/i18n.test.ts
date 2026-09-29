import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, getLanguage, locale, setLanguage, t } from '../../ui/src/lib/i18n';
import { EN, ZH } from '../../ui/src/lib/messages';

describe('界面多语言', () => {
  it('默认中文，切到英语后同一个 key 出英文', () => {
    expect(DEFAULT_LANGUAGE).toBe('zh');
    setLanguage('zh');
    expect(t('app.title')).toBe('代理控制面板');

    setLanguage('en');
    expect(t('app.title')).toBe('Proxy Control Panel');

    setLanguage('zh');
    expect(getLanguage()).toBe('zh');
  });

  it('切到英语后占位符与日期区域一起变', () => {
    setLanguage('en');
    expect(t('failed.add', { count: 3 })).toBe('Add 3 rules');
    expect(locale()).toBe('en-US');

    setLanguage('zh');
    expect(t('failed.add', { count: 3 })).toBe('添加 3 条规则');
    expect(locale()).toBe('zh-CN');
  });

  it('两张表的 key 完全对齐', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort());
  });
});
