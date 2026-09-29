/**
 * 渲染层唯一的原生能力：离线兜底动作与安全退出。
 * 打包后 sandbox: true，preload 必须是 CommonJS，所以这里是 .cjs。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandbox: true 下 preload 只能是 CommonJS
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mcpOffline', {
  /** 离线兜底按钮：'shutdown' 完全关闭代理、'restart' 立即重启内核。 */
  action: (name) => ipcRenderer.invoke('mcp:offline-action', name),
});

contextBridge.exposeInMainWorld('mcpApp', {
  /** 安全关闭：先关闭系统代理并停内核，再退出应用。 */
  quitSafely: () => ipcRenderer.invoke('mcp:quit-safely'),
});
