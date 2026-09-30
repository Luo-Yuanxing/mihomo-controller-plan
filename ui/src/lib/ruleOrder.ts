/**
 * 规则列表的域名层级排序：标签从右往左比，1 级域名（com / net）定顶层顺序，2 级（qq / 163）定下一层，
 * 以此类推。不看规则类型——DOMAIN 与 DOMAIN-SUFFIX 的域名混在一起排。
 */

/** 取出可排序的域名标签（已反转，最右标签在前）；IP、CIDR、GEOIP、MATCH 等返回 null。 */
function domainLabels(value: string): string[] | null {
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  // 全数字标签是 IPv4 字面量，没有域名层级；其余非域名取值连点都不合法
  if (labels.every((label) => /^\d+$/.test(label))) return null;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)
    ? labels.reverse()
    : null;
}

/** 比较器：域名按层级排在前，非域名整体保持原序垫底（配合稳定的 Array#sort）。 */
export function compareByDomain(left: string, right: string): number {
  const a = domainLabels(left);
  const b = domainLabels(right);
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
