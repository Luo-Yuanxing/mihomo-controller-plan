/**
 * 配置模板渲染，产出 data/config.yaml。
 * 计划 §7.1 生成的 config.yaml。
 */
import type { Settings } from '../settings.js';

export interface TemplateOptions {
  settings: Settings;
  secret: string;
  /** 为 null 时不引用订阅文件，代理组用 REJECT-DROP 占位：命中 PROXY 的流量直接丢弃并超时。 */
  subscriptionProvider: string | null;
  ruleProvider: string;
}

/**
 * 生成 mihomo 配置：rules 段只留骨架，业务规则全部走 rule-provider（计划 §7.1）。
 */
export function renderConfig(options: TemplateOptions): string {
  const { settings, secret } = options;
  const lines = [
    '# 由 mihomo-controller-plan 生成，请勿手工修改',
    `mixed-port: ${settings.core.mixedPort}`,
    'mode: rule',
    'log-level: info',
    // 用本地 geoip.dat/geosite.dat，避免内核去 GitHub 下载 MMDB 而卡在启动阶段
    'geodata-mode: true',
    'geo-auto-update: false',
    `external-controller: 127.0.0.1:${settings.core.controllerPort}`,
    `secret: "${secret}"`,
    '',
    'dns:',
    '  enable: true',
    '  enhanced-mode: fake-ip',
    '  nameserver:',
    '    - https://doh.pub/dns-query',
    '',
  ];

  if (options.subscriptionProvider !== null) {
    lines.push(
      'proxy-providers:',
      `  ${options.subscriptionProvider}:`,
      '    type: file',
      '    path: ./subscription.yaml',
      '    health-check:',
      '      enable: true',
      '      url: https://www.gstatic.com/generate_204',
      '      interval: 300',
      '',
    );
  }

  lines.push(
    'rule-providers:',
    `  ${options.ruleProvider}:`,
    '    type: file',
    '    behavior: classical',
    `    path: ./rules/${options.ruleProvider}.yaml`,
    '',
    'proxy-groups:',
    '  - name: PROXY',
    '    type: select',
  );

  if (options.subscriptionProvider === null) {
    // 无订阅时不能用 DIRECT 兜底，否则命中 PROXY 的规则会静默变成直连（被墙且无提示）
    lines.push('    proxies:', '      - REJECT-DROP');
  } else {
    lines.push('    use:', `      - ${options.subscriptionProvider}`);
  }

  lines.push(
    '',
    'rules:',
    `  - RULE-SET,${options.ruleProvider},PROXY`,
    '  - GEOIP,CN,DIRECT',
    '  - MATCH,PROXY',
    '',
  );

  return lines.join('\n');
}
