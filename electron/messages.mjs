/**
 * Electron 壳的用户可见文案：托盘菜单、对话框、IPC 错误。
 * 与后端同一套约定：只有中文（默认）与英语；语言存在 config.json 的 language 字段里，
 * 启动时读一次，界面切换语言后再通过 IPC 同步。
 */
const ZH = {
  appTitle: '代理控制面板',
  trayShowWindow: '显示窗口',
  trayRestartKernel: '启动 / 重启内核',
  trayEnableProxy: '开启系统代理',
  trayDisableProxy: '关闭系统代理',
  trayQuitSafely: '安全退出（先关闭系统代理）',
  proxyEnableFailed: '开启系统代理失败',
  proxyDisableFailed: '关闭系统代理失败',
  kernelStartFailed: '启动内核失败',
  quitDisabledProxyTitle: '无法关闭系统代理',
  quitDisabledProxyMessage: '后端不可用，系统代理可能仍指向内核端口',
  quitDisabledProxyDetail:
    '仍然退出后，请到「Windows 设置 → 网络和 Internet → 代理」手动关闭。\n\n原因：{error}',
  quitDisabledProxyCancel: '取消退出',
  quitDisabledProxyConfirm: '仍然退出',
  quitTitle: '退出代理控制面板',
  quitMessage: '退出后代理将停止',
  quitDetail: '退出前会关闭系统代理，内核一并停止。',
  quitCancel: '取消',
  quitConfirm: '退出',
  actionFailed: '后端不可用，无法执行该动作：{error}{hint}',
  devBackendHint: '（开发期后端是独立进程，请重启 npm run dev）',
};

const EN = {
  appTitle: 'Proxy Control Panel',
  trayShowWindow: 'Show window',
  trayRestartKernel: 'Start / restart kernel',
  trayEnableProxy: 'Enable system proxy',
  trayDisableProxy: 'Disable system proxy',
  trayQuitSafely: 'Quit safely (disable system proxy first)',
  proxyEnableFailed: 'Failed to enable the system proxy',
  proxyDisableFailed: 'Failed to disable the system proxy',
  kernelStartFailed: 'Failed to start the kernel',
  quitDisabledProxyTitle: 'Cannot disable the system proxy',
  quitDisabledProxyMessage:
    'The backend is unavailable, the system proxy may still point to the kernel port',
  quitDisabledProxyDetail:
    'If you quit anyway, turn it off manually in Windows Settings → Network & Internet → Proxy.\n\nReason: {error}',
  quitDisabledProxyCancel: 'Cancel quit',
  quitDisabledProxyConfirm: 'Quit anyway',
  quitTitle: 'Quit Proxy Control Panel',
  quitMessage: 'The proxy will stop after quitting',
  quitDetail: 'The system proxy is disabled and the kernel is stopped before quitting.',
  quitCancel: 'Cancel',
  quitConfirm: 'Quit',
  actionFailed: 'The backend is unavailable, cannot run this action: {error}{hint}',
  devBackendHint: ' (in dev the backend is a separate process, restart npm run dev)',
};

const TABLES = { zh: ZH, en: EN };

export const DEFAULT_LANGUAGE = 'zh';

export function isLanguage(value) {
  return value === 'zh' || value === 'en';
}

/** 取某个语言下的文案，`{name}` 占位符用 params 替换。 */
export function t(language, key, params = {}) {
  const table = TABLES[isLanguage(language) ? language : DEFAULT_LANGUAGE];
  const template = table[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
