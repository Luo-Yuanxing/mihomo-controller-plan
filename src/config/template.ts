/**
 * 配置模板渲染，产出 data/config.yaml。
 * 计划 §7.1 生成的 config.yaml。
 */
import type { Settings } from '../settings.js';

export interface TemplateOptions {
  settings: Settings;
  secret: string;
  subscriptionProvider: string;
  ruleProvider: string;
}

export function renderConfig(_options: TemplateOptions): string {
  throw new Error('未实现：渲染 config.yaml');
}
