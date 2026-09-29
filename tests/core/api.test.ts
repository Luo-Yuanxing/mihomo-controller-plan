import { describe, expect, it } from 'vitest';
import { proxyGroups, type ProxySnapshot } from '../../src/core/api.js';

describe('proxyGroups', () => {
  it('只保留带 all 的组，节点被过滤并补上空 now', () => {
    const snapshot: ProxySnapshot = {
      PROXY: { name: 'PROXY', type: 'Selector', now: '香港', all: ['香港', '日本'] },
      failover: { name: 'failover', type: 'Fallback', all: ['日本'] },
      空组: { name: '空组', type: 'Selector', now: 'DIRECT', all: [] },
      香港: { name: '香港', type: 'Vless' },
    };

    const groups = proxyGroups(snapshot);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.name).sort()).toEqual(['PROXY', 'failover']);
    expect(groups.find((group) => group.name === 'failover')?.now).toBe('');
    expect(groups.find((group) => group.name === 'PROXY')?.now).toBe('香港');
  });
});
