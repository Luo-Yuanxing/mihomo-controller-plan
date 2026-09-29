import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_CONFIG as BACKEND_DEFAULT } from '../../src/ui-config.js';
import { uiConfigIssues as backendIssues } from '../../src/ui-config.js';
import { DEFAULT_UI_CONFIG as FRONTEND_DEFAULT } from '../../ui/src/lib/types.js';
import { uiConfigIssues as frontendIssues } from '../../ui/src/lib/validateUiConfig.js';

/** 同一批用例喂给前后端两份实现，结果必须逐字一致。 */
const CASES: { name: string; value: unknown }[] = [
  { name: '两端默认值都合法', value: BACKEND_DEFAULT },
  { name: '前端默认值也合法', value: FRONTEND_DEFAULT },
  { name: '不是对象', value: 'nope' },
  { name: '缺字段', value: {} },
  { name: 'ruleTypes 为空数组', value: { ...BACKEND_DEFAULT, ruleTypes: [] } },
  {
    name: 'ruleTypes 有重复项',
    value: { ...BACKEND_DEFAULT, ruleTypes: ['DOMAIN', 'DOMAIN'] },
  },
  {
    name: 'ruleTypes 格式不对',
    value: { ...BACKEND_DEFAULT, ruleTypes: ['domain suffix'] },
  },
  {
    name: 'ruleTypes 元素不是字符串',
    value: { ...BACKEND_DEFAULT, ruleTypes: [1] },
  },
  {
    name: 'defaults.ruleType 不在列表里',
    value: { ...BACKEND_DEFAULT, defaults: { ruleType: 'GEOIP', policy: 'PROXY' } },
  },
  {
    name: 'policies 缺 label 且有重复 value',
    value: {
      ...BACKEND_DEFAULT,
      policies: [
        { value: 'PROXY', label: '' },
        { value: 'PROXY', label: '代理2' },
      ],
    },
  },
  {
    name: 'policies 的 value 含逗号',
    value: { ...BACKEND_DEFAULT, policies: [{ value: 'PRO,XY', label: '代理' }] },
  },
  {
    name: 'defaults.policy 不在列表里',
    value: { ...BACKEND_DEFAULT, defaults: { ruleType: 'DOMAIN', policy: 'REJECT' } },
  },
  {
    name: '轮询间隔过小',
    value: {
      ...BACKEND_DEFAULT,
      failedConnections: { refetchIntervalMs: 100, lines: 5000 },
    },
  },
  {
    name: '扫描行数过大且日志轮询为小数',
    value: {
      ...BACKEND_DEFAULT,
      failedConnections: { refetchIntervalMs: 5000, lines: 99999 },
      settings: { logsRefetchIntervalMs: 1500.5 },
    },
  },
];

describe('前后端取值检测一致性', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      expect(frontendIssues(testCase.value)).toEqual(backendIssues(testCase.value));
    });
  }

  it('合法配置两端都无问题', () => {
    expect(backendIssues(BACKEND_DEFAULT)).toEqual([]);
    expect(frontendIssues(BACKEND_DEFAULT)).toEqual([]);
  });
});
