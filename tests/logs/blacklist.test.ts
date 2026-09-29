import { describe, expect, it } from 'vitest';
import {
  applyBlacklistChanges,
  canonicalHost,
  createHostMatcher,
  MAX_BLACKLIST_HOSTS,
  parseBlacklistHosts,
} from '../../src/logs/blacklist.js';

describe('黑名单主机匹配', () => {
  it('精确主机命中自己，不命中其它域', () => {
    const match = createHostMatcher(['example.com']);
    expect(match('example.com')).toBe(true);
    expect(match('EXAMPLE.com')).toBe(true);
    expect(match('www.example.com')).toBe(false);
  });

  it('通配前缀只命中子域，不命中它自己', () => {
    const match = createHostMatcher(['*.example.com']);
    expect(match('a.example.com')).toBe(true);
    expect(match('a.b.example.com')).toBe(true);
    expect(match('example.com')).toBe(false);
    // 后缀必须按点对齐：ample.com 不算 example.com 的子域
    expect(match('notexample.com')).toBe(false);
  });

  it('两类写法可以混着放，一条不命中就看下一条', () => {
    const match = createHostMatcher(['example.com', '*.cdn.net']);
    expect(match('cdn.net')).toBe(false);
    expect(match('img.cdn.net')).toBe(true);
    expect(match('example.com')).toBe(true);
  });

  it('归一化只做去空白与小写，通配前缀原样保留', () => {
    expect(canonicalHost('  ExAmPle.COM ')).toBe('example.com');
    expect(canonicalHost('*.Example.com')).toBe('*.example.com');
  });
});

describe('黑名单主机校验', () => {
  it('接受域名、IPv4、IPv6 与通配写法', () => {
    expect(parseBlacklistHosts(['Example.com', '1.2.3.4', '[2001:db8::1]', '*.a-b.cn'])).toEqual([
      'example.com',
      '1.2.3.4',
      '[2001:db8::1]',
      '*.a-b.cn',
    ]);
  });

  it('通配只能挂最前面且必须跟着域名', () => {
    for (const host of ['*', '*.', 'a*.b.com', 'example.*']) {
      expect(() => parseBlacklistHosts([host])).toThrow();
    }
  });

  it('空串、非字符串数组与超量都拒绝', () => {
    expect(() => parseBlacklistHosts([''])).toThrow();
    expect(() => parseBlacklistHosts(['example.com', 1])).toThrow();
    expect(() => parseBlacklistHosts('example.com')).toThrow();
    const tooMany = Array.from(
      { length: MAX_BLACKLIST_HOSTS + 1 },
      (_, index) => `h${String(index)}.com`,
    );
    expect(() => parseBlacklistHosts(tooMany)).toThrow();
  });

  it('同一主机只留一条（按归一化去重）', () => {
    expect(parseBlacklistHosts(['Example.com', 'example.com', 'EXAMPLE.COM'])).toEqual([
      'example.com',
    ]);
  });
});

describe('黑名单增删', () => {
  it('新增去重并计数，已在里面的算跳过', () => {
    // 同一批里的重复并成一条；已在列表里的才算"跳过"
    const result = applyBlacklistChanges(['a.com', 'b.com'], { add: ['b.com', 'c.com', 'c.com'] });
    expect(result.hosts).toEqual(['a.com', 'b.com', 'c.com']);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('删除不存在的只计数，不报错', () => {
    const result = applyBlacklistChanges(['a.com', 'b.com'], { remove: ['a.com', 'x.com'] });
    expect(result.hosts).toEqual(['b.com']);
    expect(result.removed).toBe(1);
    expect(result.missing).toBe(1);
  });
});
