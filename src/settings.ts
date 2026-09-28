/**
 * data/settings.json 读写。
 * 计划 §3.1 数据存放约定、§5.1 订阅配置、§5.5 系统代理期望值。
 */
export interface Settings {
  subscription: {
    url: string;
    interval: number;
    useProxy: boolean;
    userAgent: string;
  };
  core: {
    binaryPath: string;
    mixedPort: number;
    controllerPort: number;
    secret: string;
  };
  proxy: {
    enabled: boolean;
    server: string;
    override: string;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  subscription: {
    url: '',
    interval: 86_400,
    useProxy: false,
    userAgent: 'clash-verge/v3',
  },
  core: {
    binaryPath: 'resources/bin/mihomo.exe',
    mixedPort: 7890,
    controllerPort: 9090,
    secret: '',
  },
  proxy: {
    enabled: false,
    server: '127.0.0.1:7890',
    override: 'localhost;127.*;10.*;172.16.*;192.168.*',
  },
};

/** 读取设置，缺失或损坏时返回默认值（首次启动自动重建）。 */
export function loadSettings(_dataDir: string): Settings {
  throw new Error('未实现：读取 data/settings.json');
}

/** 写设置，走"临时文件 → rename 覆盖"。 */
export function saveSettings(_dataDir: string, _settings: Settings): void {
  throw new Error('未实现：写入 data/settings.json');
}
