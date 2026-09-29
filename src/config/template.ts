/**
 * 配置模板渲染，产出 data/config.yaml。
 * 计划 §7.1 生成的 config.yaml。
 */
import type { Settings } from '../settings.js';
import type { RenderedGroup } from '../sub/groups.js';

/** 目标策略里的"代理"落在哪个组：规则策略值、生成配置的组名都用它。 */
export const PROXY_GROUP_NAME = 'PROXY';

export interface TemplateOptions {
  settings: Settings;
  secret: string;
  /** 为 null 时不引用订阅文件，代理组用 REJECT-DROP 占位：命中 PROXY 的流量直接丢弃并超时。 */
  subscriptionProvider: string | null;
  ruleProvider: string;
  /**
   * 用户在设置里选了"PROXY 指代订阅哪个组"时的组定义（含递归引用到的组）。
   * null / 空数组 = PROXY 直接用订阅全部节点。
   */
  proxyGroupPlan?: RenderedGroup[] | null;
}

/** 标识符与 http(s) 网址才不加引号，其余（含空格、• 等）一律双引号包住。 */
const SAFE_SCALAR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_URL = /^https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function yamlScalar(value: unknown): string {
  if (typeof value === 'string') {
    return SAFE_SCALAR.test(value) || SAFE_URL.test(value) ? value : JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? 'null';
}

/** 复刻组：节点成员由 use 提供，组与组的引用写在 proxies。 */
function renderGroupLines(group: RenderedGroup, provider: string): string[] {
  const lines = [
    `  - name: ${yamlScalar(group.name)}`,
    `    type: ${yamlScalar(group.type)}`,
    '    use:',
    `      - ${provider}`,
  ];
  if (group.refs.length > 0) {
    lines.push('    proxies:', ...group.refs.map((ref) => `      - ${yamlScalar(ref)}`));
  }
  for (const { key, value } of group.extra) lines.push(`    ${key}: ${yamlScalar(value)}`);
  return lines;
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
    // 代理组的当前选择落 cache.db，否则每次重启都回到第一个节点
    'profile:',
    '  store-selected: true',
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
  );

  const plan = options.subscriptionProvider === null ? null : (options.proxyGroupPlan ?? null);

  lines.push('proxy-groups:');
  if (plan !== null && plan.length > 0 && options.subscriptionProvider !== null) {
    for (const group of plan) lines.push(...renderGroupLines(group, options.subscriptionProvider));
  } else if (options.subscriptionProvider === null) {
    // 无订阅时不能用 DIRECT 兜底，否则命中 PROXY 的规则会静默变成直连（被墙且无提示）
    lines.push(
      `  - name: ${PROXY_GROUP_NAME}`,
      '    type: select',
      '    proxies:',
      '      - REJECT-DROP',
    );
  } else {
    lines.push(
      `  - name: ${PROXY_GROUP_NAME}`,
      '    type: select',
      '    use:',
      `      - ${options.subscriptionProvider}`,
    );
  }

  lines.push(
    '',
    'rules:',
    // rule-provider 里每条规则自带目标策略，命中就按规则走；没命中一律直连
    `  - RULE-SET,${options.ruleProvider},${PROXY_GROUP_NAME}`,
    '  - MATCH,DIRECT',
    '',
  );

  return lines.join('\n');
}
