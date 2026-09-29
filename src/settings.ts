/**
 * 应用设置（内核/订阅/系统代理）的结构与默认值。
 * 存储位置见 app-config.ts：工作目录下统一配置文件 config.json 的 core/subscription/proxy 段。
 * 计划 §3.1 数据存放约定、§5.1 订阅配置、§5.5 系统代理期望值。
 */
import { z } from 'zod';

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
