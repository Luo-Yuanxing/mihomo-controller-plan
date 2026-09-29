import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings.js';
import { DEFAULT_UI_CONFIG, UiConfigValidationError } from '../../src/ui-config.js';
import { decodeSharedConfig, encodeSharedConfig } from '../../src/ui-config-share.js';

function payloadOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('配置分享串', () => {
  it('编解码一来一回：界面常量、规则、内核与代理设置都在', () => {
    const payload = encodeSharedConfig({
      config: { ...DEFAULT_UI_CONFIG, ruleTypes: ['DOMAIN'], defaults: { ruleType: 'DOMAIN', policy: 'PROXY' } },
      rules: [{ enabled: true, type: 'DOMAIN', value: 'a.com', policy: 'PROXY', noResolve: true }],
      app: {
        core: { binaryPath: 'C:/x/mihomo.exe', mixedPort: 7891 },
        proxy: { enabled: true, override: 'localhost;127.*' },
      },
    });

    const shared = decodeSharedConfig(payload);

    expect(shared.config.ruleTypes).toEqual(['DOMAIN']);
    expect(shared.rules).toHaveLength(1);
    expect(shared.app?.core).toEqual({ binaryPath: 'C:/x/mihomo.exe', mixedPort: 7891 });
    expect(shared.app?.proxy).toEqual({ enabled: true, override: 'localhost;127.*' });
  });

  it('生成的串里没有订阅与 secret', () => {
    const payload = encodeSharedConfig({
      config: DEFAULT_UI_CONFIG,
      rules: [],
      app: {
        core: { binaryPath: 'resources/bin/mihomo.exe', mixedPort: 7890 },
        proxy: { enabled: false, override: DEFAULT_SETTINGS.proxy.override },
      },
    });

    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    expect(decoded).not.toContain('subscription');
    expect(decoded).not.toContain('secret');
    expect(decoded).not.toContain('userAgent');
  });

  it('别人硬塞进来的订阅段与 secret 会被丢掉', () => {
    const shared = decodeSharedConfig(
      payloadOf({
        ...DEFAULT_UI_CONFIG,
        rules: [],
        core: { binaryPath: 'C:/x/mihomo.exe', mixedPort: 7890, secret: 'steal-me' },
        subscription: { url: 'https://private.example/sub', useProxy: true, userAgent: 'ua', proxyGroup: 'Proxy' },
        proxy: { enabled: true, override: 'localhost;127.*' },
      }),
    );

    expect(shared.app?.subscription).toBeUndefined();
    expect(shared.app?.core).toEqual({ binaryPath: 'C:/x/mihomo.exe', mixedPort: 7890 });
    expect(shared.app?.proxy?.enabled).toBe(true);
  });

  it('被折行或插了空格的串照样能导入（Base64 不看词边界）', () => {
    const payload = encodeSharedConfig({
      config: DEFAULT_UI_CONFIG,
      rules: [],
      app: { proxy: { enabled: true, override: 'localhost;127.*' } },
    });
    const wrapped = `${payload.slice(0, 20)}\r\n  ${payload.slice(20, 40)}\n${payload.slice(40)}`;

    const shared = decodeSharedConfig(wrapped);

    expect(shared.config).toEqual(DEFAULT_UI_CONFIG);
    expect(shared.app?.proxy?.enabled).toBe(true);
  });

  it('空串、非 Base64、非 JSON、字段非法都带原因拒绝', () => {
    expect(() => decodeSharedConfig('   ')).toThrow('不能为空');
    expect(() => decodeSharedConfig('这不是base64!!')).toThrow('不是合法的 Base64URL 字符串');
    expect(() => decodeSharedConfig(Buffer.from('不是 json', 'utf8').toString('base64url'))).toThrow(
      '不是合法 JSON',
    );
    expect(() => decodeSharedConfig(payloadOf({ ruleTypes: [] }))).toThrow(UiConfigValidationError);
    expect(() =>
      decodeSharedConfig(payloadOf({ ...DEFAULT_UI_CONFIG, core: { mixedPort: 70000 } })),
    ).toThrow('core.mixedPort');
  });
});
