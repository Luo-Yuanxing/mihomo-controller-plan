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
    interval: z.number().int().positive(),
    useProxy: z.boolean(),
    userAgent: z.string().min(1),
  }),
  core: z.object({
    binaryPath: z.string().min(1),
    mixedPort: z.number().int().min(1).max(65535),
    controllerPort: z.number().int().min(1).max(65535),
    secret: z.string(),
  }),
  proxy: z.object({
    enabled: z.boolean(),
    server: z.string().min(1),
    override: z.string(),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

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
