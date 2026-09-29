/**
 * 后端用户可见消息的多语言入口：只有中文（默认）与英语两套，见 i18n-messages.ts。
 *
 * 语言存在 config.json 的 language 字段里，由 ui-config 加载生效值时同步过来；
 * 若抛错发生在读配置之前，按默认中文输出。
 */
import { EN, ZH, type MessageKey } from './i18n-messages.js';

export type Language = 'zh' | 'en';

/** 限定语言取值，界面与配置文件都用这一份。 */
export const LANGUAGES: readonly Language[] = ['zh', 'en'];

export const DEFAULT_LANGUAGE: Language = 'zh';

export function isLanguage(value: unknown): value is Language {
  return value === 'zh' || value === 'en';
}

let current: Language = DEFAULT_LANGUAGE;

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  current = next;
}

export type MessageParams = Record<string, string | number>;

/** 取当前语言的消息，`{name}` 占位符用 params 替换；缺参数或空模板原样返回。 */
export function t(key: MessageKey, params: MessageParams = {}): string {
  const table: Record<string, string> = current === 'en' ? EN : ZH;
  const template = table[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export type { MessageKey };
