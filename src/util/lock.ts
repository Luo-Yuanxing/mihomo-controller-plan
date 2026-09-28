/**
 * data/run/*.lock 文件锁。
 * 计划 §4.4 单实例（app.lock / core.lock）。
 */
export interface Lock {
  release(): void;
}

/** 拿不到锁属于环境类异常，直接抛错（fail-stop）。 */
export function acquireLock(_lockFile: string): Lock {
  throw new Error('未实现：文件锁');
}
