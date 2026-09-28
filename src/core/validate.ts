/**
 * 应用前预检：`mihomo -t`。
 * 计划 §1.3 S4、§5.2 内核托管。
 */
export interface ValidateResult {
  ok: boolean;
  output: string;
}

export async function validateConfig(
  _binaryPath: string,
  _configFile: string,
): Promise<ValidateResult> {
  throw new Error('未实现：mihomo -t 预检');
}
