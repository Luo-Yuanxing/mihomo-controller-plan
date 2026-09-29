/**
 * ProxyGuard：只保证自己写进注册表的三项不被别人改掉。
 * 计划 §5.5、FR-08、FR-09。
 *
 * 守护与系统代理开关捆绑，不提供单独开关：enable 就纳入守护，disable 就停止守护，
 * 所以界面上只有"开启系统代理 / 关闭系统代理"两个动作。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const POLL_INTERVAL_MS = 60_000;

/**
 * 本机回落必须绕过系统代理：否则应用自身的请求会被送进自己的 mixed 端口，
 * 变成"自己代理自己"。这两项由程序兜底，界面改不掉。
 */
const REQUIRED_BYPASS = ['localhost', '127.*'] as const;

/** 把必需项并入 ProxyOverride：去空项、按小写去重、保序，缺的补在末尾。 */
export function ensureLocalBypass(override: string): string {
  const entries = override
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const seen = new Set(entries.map((entry) => entry.toLowerCase()));
  for (const required of REQUIRED_BYPASS) {
    if (seen.has(required)) continue;
    entries.push(required);
    seen.add(required);
  }
  return entries.join(';');
}

/** InternetSetOption：39 = SETTINGS_CHANGED，37 = REFRESH。 */
const NOTIFY_SCRIPT = [
  '$sig=\'[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);\'',
  '$w = Add-Type -MemberDefinition $sig -Name WinInet -Namespace Mcp -PassThru',
  '$w::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null',
  '$w::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null',
].join('; ');

export interface ProxyValues {
  enable: boolean;
  server: string;
  override: string;
}

export interface ProxyState {
  desired: ProxyValues;
  actual: ProxyValues | null;
  match: boolean;
  guarding: boolean;
  supported: boolean;
  error: string | null;
}

export interface ProxyGuard {
  state(): Promise<ProxyState>;
  /** 开启系统代理并纳入守护（守护跟着开关走，没有单独的守护开关）。 */
  enable(): Promise<ProxyState>;
  /** 关闭系统代理并停止守护，把控制权交还用户。 */
  disable(): Promise<ProxyState>;
  /** 按期望值写一遍注册表，不改守护状态。 */
  apply(): Promise<ProxyState>;
  /** 换期望的代理服务器地址（混合端口变了）；正在守护就顺手写一遍注册表。 */
  setServer(server: string): Promise<ProxyState>;
  shutdown(): Promise<void>;
}

export interface ProxyGuardOptions {
  desired: ProxyValues;
  log: Logger;
  onDesiredChange: (values: ProxyValues) => Promise<void>;
}

async function readValue(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', REG_KEY, '/v', name]);
    const line = stdout.split(/\r?\n/).find((row) => row.includes(name));
    if (line === undefined) return null;
    return (
      line
        .trim()
        .split(/\s{2,}/)
        .at(-1) ?? null
    );
  } catch {
    return null;
  }
}

async function writeValue(name: string, type: string, value: string): Promise<void> {
  await execFileAsync('reg', ['add', REG_KEY, '/v', name, '/t', type, '/d', value, '/f']);
}

async function notifyWinInet(): Promise<void> {
  await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', NOTIFY_SCRIPT]);
}

export function createProxyGuard(options: ProxyGuardOptions): ProxyGuard {
  const supported = process.platform === 'win32';
  // 期望值里的 ProxyOverride 一律带上本机绕过项，写进注册表的内容不会是"没有本机绕过"的版本
  let desired: ProxyValues = {
    ...options.desired,
    override: ensureLocalBypass(options.desired.override),
  };
  let guarding = desired.enable;
  let timer: NodeJS.Timeout | null = null;
  let lastError: string | null = null;

  async function readActual(): Promise<ProxyValues | null> {
    if (!supported) return null;
    const enable = await readValue('ProxyEnable');
    const server = await readValue('ProxyServer');
    const override = await readValue('ProxyOverride');
    if (enable === null && server === null) return null;
    return {
      enable: enable !== null && Number.parseInt(enable, 16) === 1,
      server: server ?? '',
      override: override ?? '',
    };
  }

  function same(a: ProxyValues, b: ProxyValues | null): boolean {
    return (
      b !== null && a.enable === b.enable && a.server === b.server && a.override === b.override
    );
  }

  async function writeDesired(): Promise<void> {
    await writeValue('ProxyEnable', 'REG_DWORD', desired.enable ? '1' : '0');
    await writeValue('ProxyServer', 'REG_SZ', desired.server);
    await writeValue('ProxyOverride', 'REG_SZ', desired.override);
    try {
      await notifyWinInet();
    } catch (error) {
      lastError = `注册表已写入，但通知系统刷新失败：${String(error)}`;
      options.log.warn({ err: lastError }, 'ProxyGuard 刷新通知失败');
    }
  }

  async function state(): Promise<ProxyState> {
    const actual = await readActual();
    return {
      desired: { ...desired },
      actual,
      match: same(desired, actual),
      guarding,
      supported,
      error: lastError,
    };
  }

  /** 每 60 s 巡检一次，被改写就回写（计划 §5.5 轮询）。 */
  function start(): void {
    if (!supported || timer !== null || !guarding) return;
    timer = setInterval(() => {
      void (async () => {
        const actual = await readActual();
        if (same(desired, actual)) return;
        try {
          await writeDesired();
          options.log.warn({ desired }, '系统代理被改写，已按期望值回写');
        } catch (error) {
          lastError = `回写系统代理失败：${String(error)}`;
          options.log.error({ err: lastError }, 'ProxyGuard 回写失败');
        }
      })();
    }, POLL_INTERVAL_MS);
    timer.unref?.();
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function shutdown(): Promise<void> {
    stop();
    if (!supported) return;

    await writeValue('ProxyEnable', 'REG_DWORD', '0');
    try {
      await notifyWinInet();
    } catch (error) {
      lastError = `系统代理已关闭，但通知系统刷新失败：${String(error)}`;
      options.log.warn({ err: lastError }, '退出时刷新系统代理失败');
    }
  }

  return {
    state,
    async enable() {
      desired = { ...desired, enable: true };
      await options.onDesiredChange({ ...desired });
      await writeDesired();
      guarding = true;
      start();
      return state();
    },
    async disable() {
      desired = { ...desired, enable: false };
      await options.onDesiredChange({ ...desired });
      await writeDesired();
      guarding = false;
      stop();
      return state();
    },
    async apply() {
      await writeDesired();
      return state();
    },
    async setServer(server: string) {
      if (desired.server === server) return state();
      desired = { ...desired, server };
      await options.onDesiredChange({ ...desired });
      if (guarding) await writeDesired();
      return state();
    },
    shutdown,
  };
}
