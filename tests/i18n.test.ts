import { describe, expect, it } from 'vitest';
import { getLanguage, isLanguage, setLanguage, t } from '../src/i18n.js';
import { EN, ZH } from '../src/i18n-messages.js';
import { DEFAULT_UI_CONFIG, setActiveUiConfig, uiConfigIssues } from '../src/ui-config.js';

describe('后端多语言', () => {
  it('默认中文，切到英语后同一个 key 出英文', () => {
    setLanguage('zh');
    expect(t('paths.binaryEmpty')).toBe('内核路径不能为空');

    setLanguage('en');
    expect(t('paths.binaryEmpty')).toBe('Kernel path must not be empty');

    setLanguage('zh');
    expect(getLanguage()).toBe('zh');
  });

  it('占位符按参数替换，缺参数就原样留着', () => {
    setLanguage('zh');
    expect(t('rules.notFound', { id: 7 })).toBe('规则不存在：id=7');
    expect(t('rules.notFound')).toBe('规则不存在：id={id}');
  });

  it('两张表的 key 完全对齐，语言只认 zh / en', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort());
    expect(isLanguage('zh')).toBe(true);
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });

  it('生效配置里的 language 会切换后端消息语言', () => {
    setActiveUiConfig({ ...DEFAULT_UI_CONFIG, language: 'en' });
    expect(uiConfigIssues({ ...DEFAULT_UI_CONFIG, ruleTypes: [] })[0]?.message).toBe(
      'must not be empty',
    );

    setActiveUiConfig(DEFAULT_UI_CONFIG);
    expect(getLanguage()).toBe('zh');
  });
});
