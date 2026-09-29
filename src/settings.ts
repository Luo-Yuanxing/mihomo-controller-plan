/**
 * data/settings.json 读写。
 * 计划 §3.1 数据存放约定、§5.1 订阅配置、§5.5 系统代理期望值。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './util/atomic.js';

export const settingsSchema = z.object({
  subscription: z.object({
    url: z.string(),
    useProxy: z.boolean(),
    userAgent: z.string().min(1),
    /** PROXY 策略指代订阅里的哪个组；空串 = 订阅全部节点。 */
    proxyGroup: z.string(),
  }),
  core: z.object({
    binaryPath: z.string().min(1),
    mixedPort: z.number().int().min(1).max(65535),
    secret: z.string(),
  }),
  proxy: z.object({
    enabled: z.boolean(),
    override: z.string(),
  }),
});

/** 控制端口不给用户改：内核 REST 固定挂在本机 9090。 */
export const CONTROL_PORT = 9090;

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  subscription: {
    url: '',
    useProxy: false,
    userAgent: 'clash-verge/v3',
    proxyGroup: '',
  },
  core: {
    binaryPath: 'resources/bin/mihomo.exe',
    mixedPort: 7890,
    secret: '',
  },
  proxy: {
    enabled: false,
    override: 'localhost;127.*;10.*;172.16.*;192.168.*',
  },
};

export function settingsPath(dataDir: string): string {
  return path.join(dataDir, 'settings.json');
}

/** 读取设置；文件缺失时返回默认值（首次启动自动重建）。字段缺失按默认值补齐。 */
export function loadSettings(dataDir: string): Settings {
  const file = settingsPath(dataDir);
  if (!fs.existsSync(file)) return DEFAULT_SETTINGS;

  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Settings>;
  return settingsSchema.parse({
    subscription: { ...DEFAULT_SETTINGS.subscription, ...raw.subscription },
    core: { ...DEFAULT_SETTINGS.core, ...raw.core },
    proxy: { ...DEFAULT_SETTINGS.proxy, ...raw.proxy },
  });
}

/** 写设置，走"临时文件 → rename 覆盖"。 */
export async function saveSettings(dataDir: string, settings: Settings): Promise<void> {
  await writeFileAtomic(settingsPath(dataDir), `${JSON.stringify(settings, null, 2)}\n`);
}
