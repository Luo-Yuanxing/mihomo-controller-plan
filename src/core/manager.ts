/**
 * 内核进程托管：启动 / 就绪探测 / 探活 / 退出清理。
 * 计划 §5.2、§4.1 进程模型。
 */
export interface CoreManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  isAlive(): boolean;
}

export interface CoreManagerOptions {
  dataDir: string;
  binaryPath: string;
  configFile: string;
  mixedPort: number;
  controllerPort: number;
  secret: string;
}

export function createCoreManager(_options: CoreManagerOptions): CoreManager {
  throw new Error('未实现：内核托管');
}
