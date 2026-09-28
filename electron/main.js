/**
 * Electron 壳：主进程即后台常驻程序。
 * 计划 §4.1 进程模型、§4.4 单实例、FR-12 托盘常驻。
 */
import { app, BrowserWindow, Tray } from 'electron';
import path from 'node:path';

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // TODO: 开发期加载 Vite dev server，打包后 loadFile('ui/dist/index.html')
  // TODO: 关闭窗口只隐藏到托盘，不结束主进程
  win.on('close', (event) => {
    event.preventDefault();
    win?.hide();
  });

  return win;
}

function bootstrap() {
  // TODO: data/run/app.lock + app.requestSingleInstanceLock()，重复启动唤起已有窗口
  // TODO: 定位数据目录 → 打开 rules.db → 下载订阅 → 预检 → 启动内核 → 启动 ProxyGuard
  // TODO: 托盘菜单三项：显示窗口 / 立即写入系统代理 / 退出（二次确认）
}

app.whenReady().then(() => {
  createWindow();
  bootstrap();
});

// 窗口全关也不退出：代理与内核继续工作（S9）
app.on('window-all-closed', () => {});

export { createWindow, bootstrap, path };
