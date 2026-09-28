/**
 * 数据目录定位：MCP_DATA_DIR → exe 同级 data/ → %LOCALAPPDATA%。
 * 计划 §4.3 数据目录定位规则。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DataDirResult {
  dataDir: string;
  /** 是否回退到 %LOCALAPPDATA%，界面需要提示实际位置。 */
  fallback: boolean;
}

/** 运行时目录固定四件套：data/ 本身 + rules/ + logs/ + run/。 */
export function ensureDataDirs(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const sub of ['rules', 'logs', 'run']) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
}

function ensureWritable(dataDir: string): void {
  ensureDataDirs(dataDir);
  const probe = path.join(dataDir, `write-probe-${process.pid}.tmp`);
  fs.writeFileSync(probe, 'ok');
  fs.rmSync(probe, { force: true });
}

export function resolveDataDir(
  appDir: string,
  env: NodeJS.ProcessEnv = process.env,
): DataDirResult {
  const fromEnv = env['MCP_DATA_DIR'];
  if (fromEnv !== undefined && fromEnv !== '') {
    const dataDir = path.resolve(fromEnv);
    ensureWritable(dataDir);
    return { dataDir, fallback: false };
  }

  const beside = path.join(appDir, 'data');
  try {
    ensureWritable(beside);
    return { dataDir: beside, fallback: false };
  } catch {
    const base = env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    const fallbackDir = path.join(base, 'mihomo-controller-plan', 'data');
    // 仍不可写就直接抛错，由调用方按 fail-stop 处理
    ensureWritable(fallbackDir);
    return { dataDir: fallbackDir, fallback: true };
  }
}

export function dataPaths(dataDir: string) {
  return {
    dataDir,
    settings: path.join(dataDir, 'settings.json'),
    database: path.join(dataDir, 'rules.db'),
    config: path.join(dataDir, 'config.yaml'),
    subscription: path.join(dataDir, 'subscription.yaml'),
    rulesDir: path.join(dataDir, 'rules'),
    logsDir: path.join(dataDir, 'logs'),
    runDir: path.join(dataDir, 'run'),
    appLock: path.join(dataDir, 'run', 'app.lock'),
    coreLock: path.join(dataDir, 'run', 'core.lock'),
  };
}

/**
 * 解析随包分发的资源路径：
 * 开发期是 <repo>/resources/...，打包后是 <install>/resources/...（appDir 变成 app.asar）。
 */
export function resolveResourcePath(appDir: string, configured: string): string {
  if (path.isAbsolute(configured)) return configured;

  // process.resourcesPath 只在 Electron 里存在
  const packedResources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [path.join(appDir, configured)];
  if (packedResources !== undefined) {
    candidates.push(path.join(packedResources, configured.replace(/^resources[\\/]/, '')));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0] ?? configured;
}
