/**
 * 渲染层唯一的原生能力：弹 Windows 保存文件对话框（导出配置用）。
 * 打包后 sandbox: true，preload 必须是 CommonJS，所以这里是 .cjs。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandbox: true 下 preload 只能是 CommonJS
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mcpDialog', {
  /** 传入默认完整路径；返回用户选的绝对路径，取消返回 null。 */
  saveJson: (defaultPath) => ipcRenderer.invoke('mcp:save-json', defaultPath),
});

contextBridge.exposeInMainWorld('mcpOffline', {
  /** 离线兜底按钮：'shutdown' 完全关闭代理、'restart' 立即重启内核。 */
  action: (name) => ipcRenderer.invoke('mcp:offline-action', name),
});

contextBridge.exposeInMainWorld('mcpApp', {
  /** 安全关闭：先关闭系统代理并停内核，再退出应用。 */
  quitSafely: () => ipcRenderer.invoke('mcp:quit-safely'),
});
