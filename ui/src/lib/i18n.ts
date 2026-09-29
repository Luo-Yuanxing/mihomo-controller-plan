/**
 * 界面文案的多语言入口：只有中文（默认）与英语，见 messages.ts。
 *
 * 当前语言是模块级状态（唯一来源是 config.json 的 language 字段，由 App 从 /api/ui-config 同步）；
 * 组件用 useI18n() 订阅，非组件代码（REST 客户端等）直接调 t()。
 */
import { EN, ZH, type MessageKey } from './messages';

export type Language = 'zh' | 'en';

/** 语言下拉的顺序，中文在前（默认）。 */
export const LANGUAGES: readonly Language[] = ['zh', 'en'];

export const DEFAULT_LANGUAGE: Language = 'zh';

export function isLanguage(value: unknown): value is Language {
  return value === 'zh' || value === 'en';
}

let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 切换语言；值没变或不是受支持的语言时什么都不做。 */
export function setLanguage(next: Language): void {
  if (!isLanguage(next) || next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export type MessageParams = Record<string, string | number>;

/** 取当前语言下的文案，`{name}` 占位符用 params 替换。 */
export function t(key: MessageKey, params: MessageParams = {}): string {
  const table: Record<string, string> = current === 'en' ? EN : ZH;
  const template = table[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 日期时间用的区域：跟着界面语言走。 */
export function locale(): string {
  return current === 'en' ? 'en-US' : 'zh-CN';
}

export type { MessageKey };
