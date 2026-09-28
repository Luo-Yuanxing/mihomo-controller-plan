import { describe, expect, it } from 'vitest';
import { parseFailedConnections } from '../../src/logs/failed-connections.js';

const first = [
  'time="2026-09-29T06:09:51.067484900+08:00" level=warning msg="[TCP] dial PROXY (match Match/) 127.0.0.1:59269 --> chatgpt.com:443 error: connect failed: dial tcp 69.63.184.142:443: i/o timeout\\nconnect failed: dial tcp [2a03:2880::1]:443: i/o timeout"',
  'time="2026-09-29T06:09:52.067484900+08:00" level=warning msg="[TCP] dial PROXY (match Match/) 127.0.0.1:60000 --> chat.openai.com:443 error: connect failed: dial tcp 199.96.62.41:443: i/o timeout"',
].join('\n');

describe('parseFailedConnections', () => {
  it('提取失败目标并按主机端口汇总', () => {
    const second = first
      .split('\n')[0]
      ?.replace('2026-09-29T06:09:51.067484900+08:00', '2026-09-29T06:10:51.067484900+08:00');
    const result = parseFailedConnections([...first.split('\n'), second ?? '']);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      network: 'TCP',
      host: 'chatgpt.com',
      port: 443,
      count: 2,
      lastSeen: '2026-09-29T06:10:51.067484900+08:00',
    });
    expect(result[0]?.error).toContain(' | connect failed');
    expect(result[1]).toMatchObject({
      host: 'chat.openai.com',
      count: 1,
    });
  });

  it('忽略非 dial 错误和普通日志', () => {
    expect(
      parseFailedConnections([
        'time="2026-09-29T06:09:51+08:00" level=info msg="Mixed proxy listening"',
        'time="2026-09-29T06:09:51+08:00" level=error msg="initial rule provider error"',
      ]),
    ).toEqual([]);
  });
});
