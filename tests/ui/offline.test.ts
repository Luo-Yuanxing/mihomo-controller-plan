import { describe, expect, it } from 'vitest';
import { isOffline, setOffline, subscribeOffline } from '../../ui/src/lib/offline';

describe('离线状态', () => {
  it('置位与清除都会通知订阅者，且不重复通知', () => {
    let notified = 0;
    const unsubscribe = subscribeOffline(() => {
      notified += 1;
    });

    setOffline(false); // 本来就没离线，不该通知
    expect(notified).toBe(0);

    setOffline(true);
    expect(isOffline()).toBe(true);
    expect(notified).toBe(1);

    setOffline(true);
    expect(notified).toBe(1);

    setOffline(false);
    expect(isOffline()).toBe(false);
    expect(notified).toBe(2);

    unsubscribe();
    setOffline(true);
    expect(notified).toBe(2);
    setOffline(false);
  });
});
