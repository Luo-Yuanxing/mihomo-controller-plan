/**
 * Electron 壳：主进程即后台常驻程序。
 * 计划 §4.1 进程模型、§4.4 单实例、FR-12 托盘常驻。
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 开发期由 Vite dev server 提供界面，打包后加载内置后端（同一进程）。 */
const devServerUrl = process.env['MCP_DEV_SERVER_URL'] ?? '';
const port = Number(process.env['MCP_PORT'] ?? 8787);

/** @type {BrowserWindow | null} */
let win = null;
/** @type {{ close(): Promise<void>, url: string } | null} */
let runningServer = null;
let appUrl = devServerUrl;

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // TODO: 关闭窗口只隐藏到托盘；托盘菜单为 显示窗口 / 立即写入系统代理 / 退出
  win.on('close', (event) => {
    event.preventDefault();
    win?.hide();
  });

  void win.loadURL(appUrl);

  return win;
}

// 安全基线：禁止打开新窗口，禁止跳到外部地址
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(appUrl).origin) {
      event.preventDefault();
    }
  });
});

/** 主进程即后端：直接跑 dist/server.js，REST 与静态资源都在本进程内。 */
async function bootstrap() {
  if (devServerUrl !== '') return;

  const entry = pathToFileURL(path.join(app.getAppPath(), 'dist', 'server.js')).href;
  const { startServer } = await import(entry);
  runningServer = await startServer({ appDir: app.getAppPath(), port });
  appUrl = runningServer.url;
}

// 单实例：重复双击时唤起已有窗口（计划 §4.4）
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (win === null) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  void bootstrap()
    .then(() => {
      createWindow();
    })
    .catch((error) => {
      process.stderr.write(`启动失败：${String(error)}\n`);
      app.quit();
    });
});

// 托盘菜单"退出"才会走到这里：停后端、停内核（计划 §4.1 存活关系）
app.on('before-quit', () => {
  void runningServer?.close();
});

// 窗口全关也不退出：代理与内核继续工作（S9）
app.on('window-all-closed', () => {});
