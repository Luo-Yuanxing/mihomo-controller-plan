/**
 * 应用前预检：`mihomo -t`。
 * 计划 §1.3 S4、§5.2 内核托管。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ValidateResult {
  ok: boolean;
  output: string;
}

/** `mihomo -t` 只校验不启动，失败时附带原始输出（计划 §1.3 S4）。 */
export async function validateConfig(
  binaryPath: string,
  configFile: string,
): Promise<ValidateResult> {
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ['-t', '-f', configFile], {
      windowsHide: true,
    });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim();
    return { ok: false, output: output === '' ? failure.message : output };
  }
}
