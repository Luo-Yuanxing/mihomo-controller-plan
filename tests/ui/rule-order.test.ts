import { describe, expect, it } from 'vitest';
import { compareByDomain } from '../../ui/src/lib/ruleOrder';

function sorted(values: string[]): string[] {
  return [...values].sort(compareByDomain);
}

describe('compareByDomain 域名层级排序', () => {
  it('1 级域名定顶层顺序，2 级域名定下一层，逐级向内', () => {
    // com 组整体排在 net 组前：TLD 是顶层键，跨 TLD 时不被 2 级域名插队
    expect(sorted(['b.qq.com', 'a.net', 'a.qq.com', 'b.net'])).toEqual([
      'a.qq.com',
      'b.qq.com',
      'a.net',
      'b.net',
    ]);
  });

  it('同域的子域名按层级排在父域之后', () => {
    expect(sorted(['otheve.beacon.qq.com', 'beacon.qq.com', 'qq.com', 'a.qq.com'])).toEqual([
      'qq.com',
      'a.qq.com',
      'beacon.qq.com',
      'otheve.beacon.qq.com',
    ]);
  });

  it('大小写与尾点不影响排序', () => {
    expect(sorted(['B.QQ.com', 'a.qq.com.'])).toEqual(['a.qq.com.', 'B.QQ.com']);
  });

  it('非域名取值（IP / CIDR / GEOIP / MATCH / 空值）整体保持原序垫底', () => {
    const values = ['1.1.1.1', 'qq.com', '10.0.0.0/8', 'cn', 'a.qq.com', ''];
    expect(sorted(values)).toEqual(['qq.com', 'a.qq.com', '1.1.1.1', '10.0.0.0/8', 'cn', '']);
  });
});
