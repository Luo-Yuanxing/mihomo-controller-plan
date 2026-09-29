/**
 * data/run/*.lock 文件锁。
 * 计划 §4.4 单实例（app.lock / core.lock）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { t } from '../i18n.js';

export interface Lock {
  release(): void;
}

function tryCreate(lockFile: string): boolean {
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readHolder(lockFile: string): number | null {
  try {
    const pid = Number(fs.readFileSync(lockFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * 拿不到锁属于环境类异常，直接抛错（fail-stop）。
 * 进程已被杀导致锁残留时，检测 PID 不存活即可接管（计划 S10）。
 */
export function acquireLock(lockFile: string): Lock {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });

  if (!tryCreate(lockFile)) {
    const holder = readHolder(lockFile);
    if (holder !== null && isAlive(holder)) {
      throw new Error(t('lock.alreadyRunning', { pid: holder, file: lockFile }));
    }
    fs.rmSync(lockFile, { force: true });
    if (!tryCreate(lockFile)) {
      throw new Error(t('lock.acquireFailed', { file: lockFile }));
    }
  }

  return {
    release(): void {
      try {
        fs.rmSync(lockFile, { force: true });
      } catch {
        // 释放失败不改变事实，忽略
      }
    },
  };
}
