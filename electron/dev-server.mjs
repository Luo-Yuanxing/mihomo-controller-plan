/** 使用 Electron 内置 Node 运行后端，确保原生模块 ABI 一致并保留 tsx watch。 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const child = spawn(
  electron,
  [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'watch', path.join('src', 'server.ts')],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolve) => {
  child.once('exit', (code, signal) => resolve(signal === null ? (code ?? 0) : 1));
});
process.exit(exitCode);
