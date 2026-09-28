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

/**
 * 生成 mihomo 配置：rules 段只留骨架，业务规则全部走 rule-provider（计划 §7.1）。
 */
export function renderConfig(options: TemplateOptions): string {
  const { settings, secret } = options;
  return [
    '# 由 mihomo-controller-plan 生成，请勿手工修改',
    `mixed-port: ${settings.core.mixedPort}`,
    'mode: rule',
    'log-level: info',
    `external-controller: 127.0.0.1:${settings.core.controllerPort}`,
    `secret: "${secret}"`,
    '',
    'dns:',
    '  enable: true',
    '  enhanced-mode: fake-ip',
    '  nameserver:',
    '    - https://doh.pub/dns-query',
    '',
    'proxy-providers:',
    `  ${options.subscriptionProvider}:`,
    '    type: file',
    '    path: ./subscription.yaml',
    '    health-check:',
    '      enable: true',
    '      url: https://www.gstatic.com/generate_204',
    '      interval: 300',
    '',
    'rule-providers:',
    `  ${options.ruleProvider}:`,
    '    type: file',
    '    behavior: classical',
    `    path: ./rules/${options.ruleProvider}.yaml`,
    '',
    'proxy-groups:',
    '  - name: PROXY',
    '    type: select',
    '    use:',
    `      - ${options.subscriptionProvider}`,
    '',
    'rules:',
    `  - RULE-SET,${options.ruleProvider},PROXY`,
    '  - GEOIP,CN,DIRECT',
    '  - MATCH,PROXY',
    '',
  ].join('\n');
}
