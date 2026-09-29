/** 从 mihomo core.log 中提取失败连接，并按协议、主机、端口去重汇总。 */
export interface FailedConnection {
  id: string;
  network: string;
  host: string;
  port: number;
  count: number;
  /** 窗口内首次失败时刻：面板按它升序排，老目标位置稳定、新目标只往末尾追加。 */
  firstSeen: string;
  lastSeen: string;
  error: string;
}

const LOG_LINE = /^time="([^"]+)"\s+level=(?:warn(?:ing)?|error)\s+msg="(.*)"$/;
const DIAL_ERROR = /^\[(TCP|UDP)\]\s+dial\s+.+?\s+-->\s+(.+):(\d+)\s+error:\s*(.*)$/;
const RETAIN_MS = 10 * 60 * 1000;

function normalizeHost(value: string): string {
  const host = value.trim().replace(/^\[|\]$/g, '');
  return host.toLowerCase();
}

function normalizeError(value: string): string {
  const normalized = value.replace(/\\n/g, ' | ').replace(/\s+/g, ' ').trim();
  const detail =
    /(?:^|\|\s*)(?:connect failed:\s*)?dial\s+(tcp|udp)\s+(\[[^\]]+\]|[^:\s]+):(\d+):\s*([^|]+)/i.exec(
      normalized,
    );
  if (detail === null) return normalized;

  const [, protocol, host, port, reason] = detail;
  return `${(protocol ?? '').toUpperCase()} ${host ?? ''}:${port ?? ''} ${(reason ?? '').replace(/^i\/o\s+/i, '').trim()}`;
}

export function parseFailedConnections(lines: string[], now = Date.now()): FailedConnection[] {
  const grouped = new Map<string, FailedConnection>();
  const cutoff = now - RETAIN_MS;

  for (const line of lines) {
    const log = LOG_LINE.exec(line);
    if (log === null) continue;

    const [, timestamp, message] = log;
    if (timestamp === undefined || message === undefined) continue;
    const occurredAt = Date.parse(timestamp);
    if (Number.isNaN(occurredAt) || occurredAt < cutoff) continue;

    const dial = DIAL_ERROR.exec(message);
    if (dial === null) continue;

    const [, network, rawHost, rawPort, rawError] = dial;
    if (network === undefined || rawHost === undefined || rawPort === undefined) continue;

    const host = normalizeHost(rawHost);
    const port = Number(rawPort);
    if (host === '' || !Number.isInteger(port)) continue;

    const id = `${network.toLowerCase()}:${host}:${String(port)}`;
    const existing = grouped.get(id);
    if (existing === undefined) {
      grouped.set(id, {
        id,
        network,
        host,
        port,
        count: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
        error: normalizeError(rawError ?? ''),
      });
      continue;
    }

    existing.count += 1;
    existing.lastSeen = timestamp;
  }

  // 升序：新上榜的目标追加在末尾，老目标只更新 lastSeen/count，不再上下跳
  return [...grouped.values()].sort(
    (left, right) => Date.parse(left.firstSeen) - Date.parse(right.firstSeen),
  );
}
