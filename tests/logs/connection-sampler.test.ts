import { describe, expect, it } from 'vitest';
import type { ConnectionInfo } from '../../src/core/api.js';
import { createConnectionTracker } from '../../src/logs/connection-sampler.js';

/** 只填采样用得到的字段，其余留空，模拟内核快照的最小形状。 */
function snapshot(
  id: string,
  host: string,
  download: number,
  overrides: Partial<ConnectionInfo> = {},
): ConnectionInfo {
  return {
    id,
    metadata: { network: 'tcp', host, destinationPort: '443' },
    download,
    rule: 'Match',
    chains: ['DIRECT'],
    ...overrides,
  };
}

describe('createConnectionTracker', () => {
  it('有回程数据的连接不算失败', () => {
    const tracker = createConnectionTracker();
    tracker.observe([snapshot('a', 'example.com', 0)], 1000);
    expect(tracker.observe([snapshot('a', 'example.com', 9301)], 2600)).toEqual([]);
    tracker.observe([], 3000);
    tracker.observe([], 3200);

    expect(tracker.findings(3200)).toEqual([]);
  });

  it('连上了却零回程、且已关闭的连接判为被阻断', () => {
    const tracker = createConnectionTracker();
    // 正是 twitter.com 的形态：连上 Cloudflare、ClientHello 发出、零字节回程
    const connection = snapshot('a', 'twitter.com', 0, { upload: 292 });
    tracker.observe([connection], 1000);
    tracker.observe([connection], 2600);
    tracker.observe([], 3000);

    const changes = tracker.observe([], 3200);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'blocked',
      host: 'twitter.com',
      port: 443,
      rule: 'Match',
      chains: ['DIRECT'],
    });
  });

  it('只缺席一轮不算失败：快照抖动不能让连接被误判', () => {
    const tracker = createConnectionTracker();
    tracker.observe([snapshot('a', 'jitter.example', 0)], 1000);
    tracker.observe([], 1500);
    const back = tracker.observe([snapshot('a', 'jitter.example', 0)], 2000);

    expect(back).toEqual([]);
    tracker.observe([], 2500);
    expect(tracker.findings(2500).map((finding) => finding.kind)).toEqual(['stalled']);
  });

  it('零回程过短的连接不判定，避免误报浏览器预连接', () => {
    const tracker = createConnectionTracker();
    tracker.observe([snapshot('a', 'preconnect.example', 0)], 1000);
    tracker.observe([snapshot('a', 'preconnect.example', 0)], 1100);
    tracker.observe([], 1200);

    expect(tracker.observe([], 1300)).toEqual([]);
  });

  it('还挂着且零回程的连接判为无响应，不必等它超时', () => {
    const tracker = createConnectionTracker();
    const connection = snapshot('a', 'web.telegram.org', 0);

    const first = tracker.observe([connection], 1000);
    expect(first.map((finding) => finding.kind)).toEqual(['stalled']);
    // 同一轮判定不重复上报，面板靠 findings 展示当前窗口
    expect(tracker.observe([connection], 2600)).toEqual([]);
    expect(tracker.findings(2600).map((finding) => finding.kind)).toEqual(['stalled']);
  });

  it('挂起中的连接一旦有数据回程就立即摘掉', () => {
    const tracker = createConnectionTracker();
    tracker.observe([snapshot('a', 'slow.example', 0)], 1000);
    tracker.observe([snapshot('a', 'slow.example', 0)], 2600);

    expect(tracker.observe([snapshot('a', 'slow.example', 2048)], 3000)).toEqual([]);
    expect(tracker.findings(3000)).toEqual([]);
  });

  it('只认 TCP：UDP 的零回程是常态，不能当失败', () => {
    const tracker = createConnectionTracker();
    const udp = snapshot('a', 'dns.example', 0, {
      metadata: { network: 'udp', host: 'dns.example', destinationPort: '53' },
    });
    tracker.observe([udp], 1000);
    tracker.observe([], 3000);

    expect(tracker.observe([], 3200)).toEqual([]);
  });

  it('多条判定按首次观测升序（新目标只在末尾追加），clear 后清空', () => {
    const tracker = createConnectionTracker();
    tracker.observe([snapshot('a', 'old.example', 0)], 1000);
    tracker.observe([snapshot('a', 'old.example', 0), snapshot('b', 'new.example', 0)], 1600);
    tracker.observe([snapshot('b', 'new.example', 0)], 2600);
    tracker.observe([], 3000);
    tracker.observe([], 3200);

    expect(tracker.findings(3200).map((finding) => finding.host)).toEqual([
      'old.example',
      'new.example',
    ]);
    tracker.clear();
    expect(tracker.findings(3200)).toEqual([]);
  });
});
