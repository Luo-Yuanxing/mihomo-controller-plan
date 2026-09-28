/** 等待 Vite 与后端就绪后启动 Electron 开发窗口。 */
import { spawn } from 'node:child_process';
import electron from 'electron';

const uiUrl = process.env.MCP_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.MCP_DEV_API_URL ?? 'http://127.0.0.1:8787/api/status';
const timeoutMs = 30_000;

async function waitFor(url) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 开发服务尚未启动
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`开发服务未就绪：${url}`);
}

await Promise.all([waitFor(uiUrl), waitFor(apiUrl)]);

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, MCP_DEV_SERVER_URL: uiUrl },
});

const exitCode = await new Promise((resolve) => {
  child.once('exit', (code, signal) => resolve(signal === null ? (code ?? 0) : 1));
});
process.exit(exitCode);
