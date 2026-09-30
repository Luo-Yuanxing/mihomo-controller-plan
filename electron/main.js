/**
 * Electron 壳：主进程即后台常驻程序。
 * 计划 §4.1 进程模型、§4.4 单实例、FR-12 托盘常驻与退出保护、§8 托盘菜单三项。
 */
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_LANGUAGE, isLanguage, t } from './messages.mjs';
import { offlineAction } from './offline-actions.mjs';
import { ensureDesktopShortcut } from './shortcut.mjs';

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
 *   guard: { enable(): Promise<unknown>, disable(): Promise<unknown>, state(): Promise<unknown> },
 *   kernel: { stop(): Promise<unknown> },
 *   writeConfig(): Promise<void>,
 *   restartKernel(): Promise<unknown>,
 * } } | null}
 */
let runningServer = null;
let appUrl = devServerUrl;
let quitting = false;
let serverClosed = false;
/** 托盘菜单与对话框的语言：跟 config.json 的 language 走，界面切换语言后经 IPC 同步。 */
let language = DEFAULT_LANGUAGE;

/**
 * 界面离线时点的那两个按钮走进程间调用：主进程直接调后端对象（开发期后端在独立进程，退回 HTTP）。
 * 系统级动作（注册表、内核进程）只由后端执行——壳和界面都不自己动系统。
 */
ipcMain.handle('mcp:offline-action', async (_event, name) => {
  try {
    const { httpPath, run } = offlineAction(name);
    return await callBackend(httpPath, run);
  } catch (error) {
    const hint = runningServer === null ? t(language, 'devBackendHint') : '';
    throw new Error(t(language, 'actionFailed', { error: String(error), hint }));
  }
});

/** 界面的"安全关闭"按钮：与托盘退出走同一条路径，同样要先关代理再退出。 */
ipcMain.handle('mcp:quit-safely', async () => {
  await quitSafely();
  return true;
});

/** 界面切了语言：重建托盘菜单，之后的对话框也用新语言。 */
ipcMain.on('mcp:set-language', (_event, next) => setLanguage(next));

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

/** 托盘菜单"开启/关闭系统代理"：面板白屏或断网时仍能改回来。 */
async function setSystemProxyFromTray(enable) {
  const label = enable ? '开启' : '关闭';
  try {
    await callBackend(enable ? '/api/proxy/enable' : '/api/proxy/disable', (context) =>
      enable ? context.guard.enable() : context.guard.disable(),
    );
    runningServer?.context.log.info(`托盘：已${label}系统代理`);
  } catch (error) {
    dialog.showErrorBox(
      t(language, enable ? 'proxyEnableFailed' : 'proxyDisableFailed'),
      String(error),
    );
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
    dialog.showErrorBox(t(language, 'kernelStartFailed'), String(error));
  }
}

/**
 * 安全关闭：先把系统代理交还、内核停掉，再退出。
 * dev 下后端是独立进程（走 HTTP），打包下后端在本进程内（直接调对象）；两条路都要先关代理，
 * 否则后端被 concurrently -k 连带强杀时没人执行清理（Windows 上 TerminateProcess 无法捕获）。
 * 失败不静默退出：代理可能还指向没人监听的端口，必须让用户知道怎么善后。
 */
async function shutdownSafely() {
  try {
    await callBackend('/api/offline/shutdown', async (context) => {
      await context.kernel.stop();
      return { proxy: await context.guard.disable() };
    });
    runningServer?.context.log.info('安全关闭：系统代理已关闭、内核已停止');
    return true;
  } catch (error) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: [t(language, 'quitDisabledProxyCancel'), t(language, 'quitDisabledProxyConfirm')],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: t(language, 'quitDisabledProxyTitle'),
      message: t(language, 'quitDisabledProxyMessage'),
      detail: t(language, 'quitDisabledProxyDetail', { error: String(error) }),
    });
    return choice === 1;
  }
}

/** 退出的统一入口：先安全关闭，成功才真正退出；用户取消则放弃退出。 */
async function quitSafely() {
  if (quitting) return;
  quitting = true;
  if (await shutdownSafely()) {
    app.quit();
    return;
  }
  quitting = false;
}

/** 退出必须二次确认，并提示"退出后代理将停止"（计划 §8）。 */
function confirmQuit() {
  const options = {
    type: 'warning',
    buttons: [t(language, 'quitCancel'), t(language, 'quitConfirm')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: t(language, 'quitTitle'),
    message: t(language, 'quitMessage'),
    detail: t(language, 'quitDetail'),
  };
  const choice =
    win !== null && !win.isDestroyed() && win.isVisible()
      ? dialog.showMessageBoxSync(win, options)
      : dialog.showMessageBoxSync(options);
  if (choice !== 1) return;

  void quitSafely();
}

/** 托盘菜单与提示语按当前语言重建：切换语言后立刻生效。 */
function applyTrayMenu() {
  if (tray === null) return;
  tray.setToolTip(t(language, 'appTitle'));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t(language, 'trayShowWindow'), click: showWindow },
      { label: t(language, 'trayRestartKernel'), click: () => void restartKernelFromTray() },
      { label: t(language, 'trayEnableProxy'), click: () => void setSystemProxyFromTray(true) },
      { label: t(language, 'trayDisableProxy'), click: () => void setSystemProxyFromTray(false) },
      { type: 'separator' },
      { label: t(language, 'trayQuitSafely'), click: () => void confirmQuit() },
    ]),
  );
}

function createTray(iconPath) {
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    throw new Error(`托盘图标读取失败：${iconPath}`);
  }

  tray = new Tray(image);
  applyTrayMenu();
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  return tray;
}

/** 语言切换的唯一入口：非法值忽略，值没变则什么都不做。 */
function setLanguage(next) {
  if (!isLanguage(next) || next === language) return;
  language = next;
  applyTrayMenu();
}

/** 启动时先按配置里的语言：打包模式直接问同进程的后端，开发期走 HTTP。 */
async function loadInitialLanguage() {
  try {
    if (runningServer !== null) {
      setLanguage(runningServer.context.uiConfig.language);
      return;
    }
    const response = await fetch(`${appUrl}/api/ui-config`, {
      headers: apiToken === '' ? {} : { 'x-api-token': apiToken },
      // 后端还没起来也不能把窗口卡住：读不到就先用默认语言
      signal: AbortSignal.timeout(2000),
    });
    const payload = await response.json();
    setLanguage(payload?.config?.language);
  } catch {
    // 读不到就先用默认语言，界面加载完成后会再同步一次
  }
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

  // 首次运行补桌面快捷方式；版本目录换了也在这里自愈（失败只记日志）
  ensureDesktopShortcut({ shell, app, log: runningServer?.context.log });

  await loadInitialLanguage();
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
