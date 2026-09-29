/**
 * Electron 壳：主进程即后台常驻程序。
 * 计划 §4.1 进程模型、§4.4 单实例、FR-12 托盘常驻与退出保护、§8 托盘菜单三项。
 */
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 开发期由 Vite dev server 提供界面，打包后加载内置后端（同一进程）。 */
const devServerUrl = process.env['MCP_DEV_SERVER_URL'] ?? '';
const port = Number(process.env['MCP_PORT'] ?? 8787);
const apiToken = process.env['MCP_API_TOKEN'] ?? '';

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/**
 * 开发期后端跑在独立进程（此处为 null），打包后后端就在本进程内。
 * @type {{ url: string, close(): Promise<void>, context: {
 *   log: { info: Function, warn: Function },
 *   guard: { enable(): Promise<unknown>, disable(): Promise<unknown>, apply(): Promise<unknown> },
 *   writeConfig(): Promise<void>,
 *   restartKernel(): Promise<unknown>,
 * } } | null}
 */
let runningServer = null;
let appUrl = devServerUrl;
let quitting = false;
let serverClosed = false;

/** 导出配置：弹 Windows 保存对话框，默认落在传入路径（配置文件所在文件夹）。 */
ipcMain.handle('mcp:save-json', async (_event, defaultPath) => {
  const options = {
    title: '导出配置',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    ...(typeof defaultPath === 'string' && defaultPath !== '' ? { defaultPath } : {}),
  };
  const result =
    win !== null && !win.isDestroyed()
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
  return result.canceled || result.filePath === '' ? null : result.filePath;
});

/** 离线兜底动作：关代理 + 停内核 / 写期望值 + 重启内核。 */
const OFFLINE_ACTIONS = {
  shutdown: async (context) => {
    await context.kernel.stop();
    return { proxy: await context.guard.disable() };
  },
  restart: async (context) => {
    const proxy = await context.guard.apply();
    await context.writeConfig();
    return { proxy, kernel: await context.restartKernel() };
  },
};

/**
 * 界面离线时点的那两个按钮走进程间调用：主进程直接调后端对象（开发期后端在独立进程，退回 HTTP）。
 */
ipcMain.handle('mcp:offline-action', async (_event, name) => {
  const run = OFFLINE_ACTIONS[name];
  if (run === undefined) throw new Error(`未知的离线动作：${String(name)}`);
  const httpPath = name === 'shutdown' ? '/api/offline/shutdown' : '/api/offline/restart';
  return callBackend(httpPath, run);
});

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
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
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

/**
 * 托盘是面板打不开时的兜底入口：直接调用同进程的后端对象，不经 HTTP。
 * 开发期后端在独立进程里（runningServer === null），退回 HTTP。
 */
async function callBackend(httpPath, action) {
  if (runningServer === null) {
    const response = await fetch(`${appUrl}${httpPath}`, {
      method: 'POST',
      headers: apiToken === '' ? {} : { 'x-api-token': apiToken },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(String(payload?.error ?? `HTTP ${response.status}`));
    }
    return payload;
  }
  return action(runningServer.context);
}

/** 托盘菜单"立即写入系统代理"：相当于手动触发一次守护（计划 §5.5 兜底按钮）。 */
async function applySystemProxyFromTray() {
  try {
    await callBackend('/api/proxy/apply', (context) => context.guard.apply());
    runningServer?.context.log.info('托盘：已写入系统代理');
  } catch (error) {
    dialog.showErrorBox('写入系统代理失败', String(error));
  }
}

/** 托盘菜单"开启/关闭系统代理"：面板白屏或断网时仍能改回来。 */
async function setSystemProxyFromTray(enable) {
  const label = enable ? '开启' : '关闭';
  try {
    await callBackend(enable ? '/api/proxy/enable' : '/api/proxy/disable', (context) =>
      enable ? context.guard.enable() : context.guard.disable(),
    );
    runningServer?.context.log.info(`托盘：已${label}系统代理`);
  } catch (error) {
    dialog.showErrorBox(`${label}系统代理失败`, String(error));
  }
}

/** 托盘菜单"启动/重启内核"：等价于后端的 /api/kernel/restart。 */
async function restartKernelFromTray() {
  try {
    const status = await callBackend('/api/kernel/restart', async (context) => {
      await context.writeConfig();
      return context.restartKernel();
    });
    runningServer?.context.log.info({ status }, '托盘：内核已重启');
  } catch (error) {
    dialog.showErrorBox('启动内核失败', String(error));
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
      { label: '启动 / 重启内核', click: () => void restartKernelFromTray() },
      { label: '开启系统代理', click: () => void setSystemProxyFromTray(true) },
      { label: '关闭系统代理', click: () => void setSystemProxyFromTray(false) },
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
  // 窗口只访问 127.0.0.1 上的本机后端，固定直连：系统代理指向自己的 mixed 端口时，
  // 界面请求会被自己的内核吃掉（无订阅即 REJECT-DROP），面板会白屏且点不动任何按钮
  void session.defaultSession.setProxy({ mode: 'direct' }).catch((error) => {
    process.stderr.write(`设置直连失败（不影响内核）：${String(error)}\n`);
  });
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
