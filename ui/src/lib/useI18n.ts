/** 组件里取文案与语言：语言一变就重渲染，t 的结果自然跟着变。 */
import { useSyncExternalStore } from 'react';
import {
  getLanguage,
  subscribeLanguage,
  t,
  type Language,
  type MessageKey,
  type MessageParams,
} from './i18n';

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

export function useT(): (key: MessageKey, params?: MessageParams) => string {
  useLanguage();
  return t;
}
