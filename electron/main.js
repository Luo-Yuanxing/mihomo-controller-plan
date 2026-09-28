/**
 * Electron 壳：主进程即后台常驻程序。
 * 计划 §4.1 进程模型、§4.4 单实例、FR-12 托盘常驻与退出保护、§8 托盘菜单三项。
 */
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 开发期由 Vite dev server 提供界面，打包后加载内置后端（同一进程）。 */
const devServerUrl = process.env['MCP_DEV_SERVER_URL'] ?? '';
const port = Number(process.env['MCP_PORT'] ?? 8787);
const apiToken = process.env['MCP_API_TOKEN'] ?? '';

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/** @type {{ url: string, close(): Promise<void>, context: { log: { info: Function, warn: Function } } } | null} */
let runningServer = null;
let appUrl = devServerUrl;
let quitting = false;
let serverClosed = false;

function showWindow() {
  if (win === null || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

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

  win.once('ready-to-show', () => {
    win?.show();
  });

  // 关闭窗口只隐藏到托盘，不结束主进程（计划 FR-12）
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });

  win.on('closed', () => {
    win = null;
  });

  void win.loadURL(appUrl);
  return win;
}

/** 托盘菜单"立即写入系统代理"：相当于手动触发一次守护（计划 §5.5 兜底按钮）。 */
async function applySystemProxyFromTray() {
  try {
    const response = await fetch(`${appUrl}/api/proxy/apply`, {
      method: 'POST',
      headers: apiToken === '' ? {} : { 'x-api-token': apiToken },
    });
    const payload = await response.json().catch(() => null);
    runningServer?.context.log.info({ ok: response.ok }, '托盘：已请求立即写入系统代理');
    if (!response.ok) {
      dialog.showErrorBox('写入系统代理失败', String(payload?.error ?? `HTTP ${response.status}`));
    }
  } catch (error) {
    dialog.showErrorBox('写入系统代理失败', String(error));
  }
}

/** 退出必须二次确认，并提示"退出后代理将停止"（计划 §8）。 */
function confirmQuit() {
  const options = {
    type: 'warning',
    buttons: ['取消', '退出'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '退出代理控制面板',
    message: '退出后代理将停止',
    detail: '退出前会关闭系统代理，内核一并停止。',
  };
  const choice =
    win !== null && !win.isDestroyed() && win.isVisible()
      ? dialog.showMessageBoxSync(win, options)
      : dialog.showMessageBoxSync(options);
  if (choice !== 1) return;

  quitting = true;
  app.quit();
}

function quitFromTray() {
  quitting = true;
  app.quit();
}

function createTray(iconPath) {
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    throw new Error(`托盘图标读取失败：${iconPath}`);
  }

  tray = new Tray(image);
  tray.setToolTip('代理控制面板');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示窗口', click: showWindow },
      { label: '立即写入系统代理', click: () => void applySystemProxyFromTray() },
      { type: 'separator' },
      { label: '退出', click: quitFromTray },
    ]),
  );
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  return tray;
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
  let iconPath = path.join(app.getAppPath(), 'resources', 'tray.png');

  if (devServerUrl === '') {
    const { startServer } = await import(
      pathToFileURL(path.join(app.getAppPath(), 'dist', 'server.js')).href
    );
    runningServer = await startServer({
      appDir: app.getAppPath(),
      port,
      ...(apiToken === '' ? {} : { apiToken }),
    });
    appUrl = runningServer.url;

    const { resolveResourcePath } = await import(
      pathToFileURL(path.join(app.getAppPath(), 'dist', 'util', 'paths.js')).href
    );
    iconPath = resolveResourcePath(app.getAppPath(), 'resources/tray.png');
  }

  try {
    createTray(iconPath);
    runningServer?.context.log.info('托盘已就绪');
  } catch (error) {
    // 托盘起不来不影响代理工作，只少了交互入口
    runningServer?.context.log.warn({ err: String(error) }, '托盘创建失败');
  }
}

// 单实例：重复双击时唤起已有窗口（计划 §4.4）
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  // 托盘是唯一退出入口，移除 Electron 默认菜单里的退出项
  Menu.setApplicationMenu(null);
  void bootstrap()
    .then(() => {
      createWindow();
    })
    .catch((error) => {
      process.stderr.write(`启动失败：${String(error)}\n`);
      app.quit();
    });
});

// 托盘"退出"才会走到这里：关闭系统代理、停后端与内核
app.on('before-quit', (event) => {
  if (!quitting && win !== null) {
    event.preventDefault();
    confirmQuit();
    return;
  }
  quitting = true;
  if (serverClosed || runningServer === null) return;
  event.preventDefault();
  void runningServer
    .close()
    .catch(() => undefined)
    .then(() => {
      serverClosed = true;
      app.quit();
    });
});

// 窗口全关也不退出：代理与内核继续工作（S9）
app.on('window-all-closed', () => {});
