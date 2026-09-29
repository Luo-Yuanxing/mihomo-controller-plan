/**
 * 离线状态：任何请求返回 5xx 或直接失败就置位；恢复靠每秒一次的问候请求。
 * 组件用 useOffline() 订阅，非组件代码用 setOffline() 置位。
 */
import { useSyncExternalStore } from 'react';

let offline = false;
const listeners = new Set<() => void>();

export function isOffline(): boolean {
  return offline;
}

export function setOffline(next: boolean): void {
  if (offline === next) return;
  offline = next;
  for (const listener of listeners) listener();
}

export function subscribeOffline(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOffline(): boolean {
  return useSyncExternalStore(subscribeOffline, isOffline, isOffline);
}
