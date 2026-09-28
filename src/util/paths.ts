/**
 * 数据目录定位：MCP_DATA_DIR → exe 同级 data/ → %LOCALAPPDATA%。
 * 计划 §4.3 数据目录定位规则。
 */
export interface DataDirResult {
  dataDir: string;
  /** 是否回退到 %LOCALAPPDATA%，界面需要提示实际位置。 */
  fallback: boolean;
}

export function resolveDataDir(_appDir: string): DataDirResult {
  throw new Error('未实现：数据目录定位');
}
