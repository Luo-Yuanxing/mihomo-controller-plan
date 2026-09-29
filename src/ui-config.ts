/**
 * data/ui-config.json：界面上能直接看到的简单常量（下拉项、默认值、轮询间隔）。
 * 文件缺失时自动落一份默认值，改完 JSON 可在设置页点"重载常量"生效，无需重启。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { writeFileAtomic } from './util/atomic.js';

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

export interface UiConfigState {
  file: string;
  source: 'file' | 'default';
  error: string | null;
  config: UiConfig;
}

export function uiConfigPath(dataDir: string): string {
  return path.join(dataDir, 'ui-config.json');
}

let active: UiConfig = DEFAULT_UI_CONFIG;

/** 当前生效的界面常量。 */
export function getUiConfig(): UiConfig {
  return active;
}

/** 规则类型白名单（后端校验与渲染共用，改 JSON 后需重载才生效）。 */
export function getRuleTypes(): readonly string[] {
  return active.ruleTypes;
}

/**
 * 读取 JSON 并设为生效值：文件缺失先落默认文件，内容非法则回退默认并记录 error。
 * 重载按钮与启动流程都走这里。
 */
export async function loadUiConfig(dataDir: string, log?: Logger): Promise<UiConfigState> {
  const file = uiConfigPath(dataDir);
  if (!fs.existsSync(file)) {
    await writeFileAtomic(file, `${JSON.stringify(DEFAULT_UI_CONFIG, null, 2)}\n`);
    active = DEFAULT_UI_CONFIG;
    log?.info({ file }, '界面常量文件不存在，已写入默认值');
    return { file, source: 'default', error: null, config: active };
  }

  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const config = uiConfigSchema.parse(raw);
    active = config;
    log?.info({ file, ruleTypes: config.ruleTypes }, '界面常量已重载');
    return { file, source: 'file', error: null, config };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    active = DEFAULT_UI_CONFIG;
    log?.error({ file, err: message }, '界面常量不合法，已回退默认值');
    return { file, source: 'default', error: message, config: active };
  }
}
