/**
 * Electron 壳：主进程即后台常驻程序。
 * 计划 §4.1 进程模型、§4.4 单实例、FR-12 托盘常驻。
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

/** 开发期由 dev server 提供界面，打包后加载 ui/dist/index.html。 */
const devServerUrl = process.env['MCP_DEV_SERVER_URL'] ?? '';
const allowedOrigin = devServerUrl === '' ? 'file://' : new URL(devServerUrl).origin;

/** @type {BrowserWindow | null} */
let win = null;

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

  if (devServerUrl === '') {
    void win.loadFile(path.join(app.getAppPath(), 'ui/dist/index.html'));
  } else {
    void win.loadURL(devServerUrl);
  }

  return win;
}

// 安全基线：禁止打开新窗口，禁止跳到外部地址
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin)) {
      event.preventDefault();
    }
  });
});

function bootstrap() {
  // TODO: data/run/app.lock + app.requestSingleInstanceLock()，重复启动唤起已有窗口
  // TODO: 定位数据目录 → 打开 rules.db → 下载订阅 → mihomo -t 预检 → 启动内核 → 启动 ProxyGuard
}

app.whenReady().then(() => {
  createWindow();
  bootstrap();
});

// 窗口全关也不退出：代理与内核继续工作（S9）
app.on('window-all-closed', () => {});
