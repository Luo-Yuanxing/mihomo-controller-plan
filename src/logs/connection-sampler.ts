/**
 * 连接生命周期采样：把内核 /connections 快照的消失事件，翻译成"面板可见的失败"。
 *
 * 为什么需要它：内核只在 dial 阶段失败时写 warning，而 TLS 被 RST、双向零回程这类
 * "连上了但什么都没换回来"的连接不产生任何日志，只体现在快照的 upload/download 上。
 * 因此这里不解析日志，改看连接本身：出现 → 消失，消失时没有回程数据即为被阻断。
 *
 * 开销约束：只做内存 diff，不发起任何 IO；快照由调用方按节拍（≥3 s）提供，
 * 面板没人看时调用方不采样，这里的成本为零。
 */
import type { ConnectionInfo } from '../core/api.js';

/** 下载量达到此值就认为"有数据回程"，不再算失败。 */
const MIN_DOWNLOAD_BYTES = 64;
/** 零回程持续这么久才判定，避开过滤器预连接等瞬时连接。 */
const MIN_STALL_MS = 400;
/** 还挂在快照里、零回程持续这么久，就算无响应，不必等它超时。 */
const STALL_MS = 1000;
/**
 * 连续缺席几轮才结算：内核快照偶有抖动，单轮缺席就判"被阻断"会误报
 * （实测中同一条连接会下一轮又出现在快照里）。2 轮在面板节拍下约 10 s，够稳。
 */
const MISS_TOLERANCE = 2;
/** 记录保留窗口，与失败连接的 10 分钟口径保持同一量级。 */
const RETAIN_MS = 10 * 60 * 1000;
/** 记录上限：超出后丢最旧的，保证内存与单轮 diff 成本恒定。 */
const MAX_RECORDS = 500;

export interface ConnectionFinding {
  id: string;
  network: string;
  host: string;
  port: number;
  /** blocked = 已关闭且无回程；stalled = 仍挂着且无回程。 */
  kind: 'blocked' | 'stalled';
  /** 首次观测到这条连接的时刻（ISO），用于面板的时间列。 */
  firstSeen: string;
  lastSeen: string;
  rule: string;
  chains: string[];
}

export interface ConnectionTracker {
  /**
   * 喂一份快照（同一份快照可被多个调用方复用），返回**本轮增量**：
   * 新出现的零回程失败，以及由无响应转为被阻断的判定。
   */
  observe(snapshot: ConnectionInfo[], now?: number): ConnectionFinding[];
  /** 当前窗口内的全部判定，按最近一次活动倒序。 */
  findings(now?: number): ConnectionFinding[];
  /** 内核重启等场景下丢弃全部状态。 */
  clear(): void;
}

interface Record {
  finding: ConnectionFinding;
  /** 本轮快照里是否还在。 */
  active: boolean;
  download: number;
  /** 连续缺席轮数，达到 MISS_TOLERANCE 才结算。 */
  misses: number;
  /** 零回程起点：下载量涨过阈值就重置，避免把"首次观测前的存活时间"算进来。 */
  zeroSince: number;
  lastSeenMs: number;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function createConnectionTracker(): ConnectionTracker {
  const records = new Map<string, Record>();

  /** 连续缺席足够多轮：有回程数据算正常关闭，丢弃；零回程才算被阻断。 */
  function settle(record: Record, changes: ConnectionFinding[]): void {
    const stalledMs = record.lastSeenMs - record.zeroSince;
    if (record.download < MIN_DOWNLOAD_BYTES && stalledMs >= MIN_STALL_MS) {
      record.finding.kind = 'blocked';
      changes.push(record.finding);
      return;
    }
    records.delete(record.finding.id);
  }

  function prune(now: number): void {
    for (const [id, record] of records) {
      if (!record.active && now - record.lastSeenMs > RETAIN_MS) records.delete(id);
    }
    if (records.size <= MAX_RECORDS) return;
    const oldest = [...records.values()]
      .sort((left, right) => left.lastSeenMs - right.lastSeenMs)
      .slice(0, records.size - MAX_RECORDS);
    for (const record of oldest) records.delete(record.finding.id);
  }

  function findings(now: number = Date.now()): ConnectionFinding[] {
    prune(now);
    return [...records.values()].map((record) => record.finding).sort(byRecency);
  }

  return {
    observe(snapshot: ConnectionInfo[], now: number = Date.now()): ConnectionFinding[] {
      const changes: ConnectionFinding[] = [];
      const seen = new Set<string>();

      for (const connection of snapshot) {
        // 只认 TCP：UDP 是无连接语义，download 常年为 0，判了全是误报
        const metadata = connection.metadata;
        if (metadata === undefined || metadata.network !== 'tcp') continue;
        const host = (metadata.host ?? '')
          .trim()
          .replace(/^\[|\]$/g, '')
          .toLowerCase();
        const port = Number(metadata.destinationPort ?? 0);
        if (host === '' || !Number.isInteger(port) || port <= 0) continue;

        const id = connection.id;
        const download = toNumber(connection.download);
        seen.add(id);

        const existing = records.get(id);
        if (existing === undefined) {
          const finding: ConnectionFinding = {
            id,
            network: metadata.network,
            host,
            port,
            kind: 'stalled',
            firstSeen: new Date(now).toISOString(),
            lastSeen: new Date(now).toISOString(),
            rule: connection.rule ?? '',
            chains: connection.chains ?? [],
          };
          records.set(id, {
            finding,
            active: true,
            download,
            misses: 0,
            zeroSince: download < MIN_DOWNLOAD_BYTES ? now : 0,
            lastSeenMs: now,
          });
          // 首次观测即零回程：此刻就是一条"已建立但没回程"的连接，面板应当立刻看到
          if (download < MIN_DOWNLOAD_BYTES) changes.push(finding);
          continue;
        }

        existing.active = true;
        existing.misses = 0;
        existing.download = download;
        existing.lastSeenMs = now;
        existing.finding.lastSeen = new Date(now).toISOString();
        // 有数据回程就不是失败，直接摘掉，避免"曾判定失败"残留
        if (download >= MIN_DOWNLOAD_BYTES) {
          records.delete(id);
          continue;
        }
        if (existing.zeroSince === 0) existing.zeroSince = now;
        if (now - existing.zeroSince >= STALL_MS && existing.finding.kind !== 'stalled') {
          existing.finding.kind = 'stalled';
          changes.push(existing.finding);
        }
      }

      for (const [id, record] of records) {
        if (seen.has(id)) continue;
        record.active = false;
        record.misses += 1;
        if (record.misses < MISS_TOLERANCE) continue;
        settle(record, changes);
      }

      prune(now);
      return changes;
    },
    findings,
    clear() {
      records.clear();
    },
  };
}

/** 按首次观测升序：面板列表只往末尾追加，已上榜的不会被后来的失败挤动位置。 */
function byRecency(left: ConnectionFinding, right: ConnectionFinding): number {
  return Date.parse(left.firstSeen) - Date.parse(right.firstSeen);
}
