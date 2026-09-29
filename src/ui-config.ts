/**
 * 界面常量：结构定义、默认值、配置文件读取、内存中的系统值。
 * 前端配置文件（JSON，可放到任意路径）与后端持久化（SQLite，见 ui-config-store.ts）分离：
 * 文件只作"加载源"，系统值由后端独立保存，重启后仍生效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const uiConfigSchema = z.object({
  /** 规则类型下拉项，同时作为后端写入白名单。 */
  ruleTypes: z.array(z.string().min(1)).min(1),
  /** 目标策略下拉项。 */
  policies: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(1),
  defaults: z.object({ ruleType: z.string().min(1), policy: z.string().min(1) }),
  failedConnections: z.object({
    refetchIntervalMs: z.number().int().min(1000),
    lines: z.number().int().min(1),
  }),
  settings: z.object({ logsRefetchIntervalMs: z.number().int().min(1000) }),
});

export type UiConfig = z.infer<typeof uiConfigSchema>;

export const DEFAULT_UI_CONFIG: UiConfig = {
  ruleTypes: ['DOMAIN-SUFFIX', 'DOMAIN'],
  policies: [
    { value: 'PROXY', label: '代理' },
    { value: 'DIRECT', label: '直连' },
  ],
  defaults: { ruleType: 'DOMAIN-SUFFIX', policy: 'PROXY' },
  failedConnections: { refetchIntervalMs: 5000, lines: 5000 },
  settings: { logsRefetchIntervalMs: 5000 },
};

export function uiConfigPath(dataDir: string): string {
  return path.join(dataDir, 'ui-config.json');
}

let active: UiConfig = DEFAULT_UI_CONFIG;

/** 当前生效的界面常量。 */
export function getUiConfig(): UiConfig {
  return active;
}

/** 更新内存中的系统值（调用方负责持久化）。 */
export function setActiveUiConfig(config: UiConfig): UiConfig {
  active = config;
  return active;
}

/** 规则类型白名单（后端校验与渲染共用，改 JSON 后需重载才生效）。 */
export function getRuleTypes(): readonly string[] {
  return active.ruleTypes;
}

/** 校验外部 JSON（文件内容或界面提交值）。 */
export function parseUiConfig(raw: unknown): UiConfig {
  return uiConfigSchema.parse(raw);
}

/** 读配置文件：文件缺失或内容非法都抛错，由调用方决定回退策略。 */
export function readUiConfigFile(file: string): UiConfig {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`配置文件不存在或不可读：${file}`);
  }
  return parseUiConfig(JSON.parse(text));
}
