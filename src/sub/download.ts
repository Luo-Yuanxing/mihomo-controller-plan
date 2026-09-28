/**
 * 单份订阅下载与校验，原子写入 data/subscription.yaml。
 * 计划 §4.2 订阅下载、§5.1 订阅（单份）。
 */
export interface SubscriptionOptions {
  url: string;
  interval: number;
  useProxy: boolean;
  userAgent: string;
}

export interface DownloadResult {
  bytes: number;
  path: string;
}

/** 失败时保留旧文件并抛出错误；首次启动失败由调用方停止工作。 */
export async function downloadSubscription(
  _options: SubscriptionOptions,
  _dataDir: string,
): Promise<DownloadResult> {
  throw new Error('未实现：订阅下载与校验');
}
