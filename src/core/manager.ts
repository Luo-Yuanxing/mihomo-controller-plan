/**
 * 内核进程托管：启动 / 就绪探测 / 探活 / 退出清理。
 * 计划 §5.2、§4.1 进程模型。
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { Logger } from 'pino';
import { createCoreApi } from './api.js';
import { validateConfig } from './validate.js';
import { t } from '../i18n.js';
import { tailLines } from '../util/logger.js';

const execFileAsync = promisify(execFile);

export type CoreState = 'stopped' | 'running' | 'adopted' | 'failed';

export interface CoreStatus {
  state: CoreState;
  pid: number | null;
  version: string | null;
  error: string | null;
  controller: string;
  mixedPort: number;
  binaryPath: string;
}

export interface CoreManager {
  start(): Promise<CoreStatus>;
  restart(): Promise<CoreStatus>;
  stop(): Promise<void>;
  status(): CoreStatus;
  /** 换内核可执行文件；下次 start/restart 用新路径。 */
  setBinary(path: string): void;
  /** 每 10 s 探活，内核中途退出时回调（计划 §5.2 运行期）。 */
  watch(onExit: (status: CoreStatus) => void): void;
}

export interface CoreManagerOptions {
  dataDir: string;
  binaryPath: string;
  configFile: string;
  mixedPort: number;
  controllerPort: number;
  secret: string;
  coreLogFile: string;
  log: Logger;
  readyTimeoutMs?: number;
  probeIntervalMs?: number;
}

export function createCoreManager(options: CoreManagerOptions): CoreManager {
  const api = createCoreApi({
    controller: `127.0.0.1:${options.controllerPort}`,
    secret: options.secret,
  });
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  const probeIntervalMs = options.probeIntervalMs ?? 10_000;

  let child: ChildProcess | null = null;
  let state: CoreState = 'stopped';
  let version: string | null = null;
  let error: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let binaryPath = options.binaryPath;

  function status(): CoreStatus {
    return {
      state,
      pid: child?.pid ?? null,
      version,
      error,
      controller: `127.0.0.1:${options.controllerPort}`,
      mixedPort: options.mixedPort,
      binaryPath,
    };
  }

  function fail(message: string): CoreStatus {
    state = 'failed';
    error = message;
    options.log.error({ err: message }, '内核托管失败');
    return status();
  }

  function appendCoreLog(text: string): void {
    try {
      fs.appendFileSync(options.coreLogFile, text);
    } catch {
      // 日志写不进去不影响内核本身
    }
  }

  async function probe(): Promise<string | null> {
    try {
      const info = await api.version();
      return info.version;
    } catch {
      return null;
    }
  }

  /** 已有内核在跑则直接接管，不重复启动（计划 §5.2 重复双击）。 */
  async function adopt(): Promise<boolean> {
    const alive = await probe();
    if (alive === null) return false;
    state = 'adopted';
    version = alive;
    error = null;
    child = null;
    options.log.info({ version: alive }, '检测到运行中的内核，直接接管');
    return true;
  }

  async function start(): Promise<CoreStatus> {
    if (state === 'running' && child?.exitCode === null) return status();
    if (await adopt()) return status();

    if (!fs.existsSync(binaryPath)) {
      return fail(t('core.binaryMissing', { path: binaryPath }));
    }

    // 应用前必须过 mihomo -t，配置错误直接报原始错误（计划 FR-05 / S4）
    const check = await validateConfig(binaryPath, options.configFile, options.dataDir);
    if (!check.ok) {
      return fail(t('core.precheckFailed', { output: check.output }));
    }

    const args = [
      '-d',
      options.dataDir,
      '-f',
      options.configFile,
      '-ext-ctl',
      `127.0.0.1:${options.controllerPort}`,
      '-secret',
      options.secret,
    ];

    const spawned = spawn(binaryPath, args, {
      cwd: options.dataDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = spawned;
    state = 'running';
    error = null;

    spawned.stdout?.on('data', (chunk: Buffer) => appendCoreLog(chunk.toString()));
    spawned.stderr?.on('data', (chunk: Buffer) => appendCoreLog(chunk.toString()));
    spawned.on('exit', (code) => {
      appendCoreLog(`\n[mcp] 内核进程退出，退出码 ${String(code)}\n`);
      if (state === 'running') {
        state = 'failed';
        error = t('core.exitedUnexpectedly', { code: String(code) });
      }
    });

    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      const alive = await probe();
      if (alive !== null) {
        version = alive;
        options.log.info({ version: alive, pid: spawned.pid }, '内核就绪');
        return status();
      }
      if (spawned.exitCode !== null) {
        return fail(t('core.exitedImmediately', { code: String(spawned.exitCode) }));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const tail = tailLines(options.coreLogFile, 20).join('\n');
    return fail(
      t('core.notReady', {
        ms: readyTimeoutMs,
        tail: tail === '' ? t('core.noOutput') : tail,
      }),
    );
  }

  async function stop(): Promise<void> {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    const running = child;
    child = null;
    state = 'stopped';
    version = null;
    if (running === null || running.exitCode !== null) return;

    const pid = running.pid;
    if (process.platform === 'win32' && pid !== undefined) {
      try {
        await execFileAsync('taskkill', ['/pid', String(pid), '/t', '/f']);
      } catch {
        // 已退出或权限不足，下面再兜一次
      }
    }
    running.kill('SIGTERM');
  }

  function watch(onExit: (status: CoreStatus) => void): void {
    if (timer !== null) return;
    timer = setInterval(() => {
      if (state !== 'running') return;
      if (child !== null && child.exitCode !== null) {
        const failed = fail(t('core.watchExited', { code: String(child.exitCode) }));
        onExit(failed);
      }
    }, probeIntervalMs);
    timer.unref?.();
  }

  return {
    start,
    async restart() {
      await stop();
      return start();
    },
    stop,
    status,
    setBinary(next: string) {
      binaryPath = next;
    },
    watch,
  };
}
