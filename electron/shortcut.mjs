/**
 * 桌面快捷方式：exe 所在目录带版本号（P:\Program Files\代理控制面板-1.0.2\…），
 * 链接一旦指向旧版本就是死链，所以每次启动校验一次、需要时才重建。
 * 链接名与 scripts/deploy.mjs 的 linkName 同源（产品名 + .lnk），两处互不覆盖。
 */
import path from 'node:path';

/**
 * 该做什么：读不出链接就建，指向别的 exe 就修，指对了不动。
 * @param {string | null} currentTarget 现有链接的目标，读不出为 null
 * @param {string} execPath 当前运行的 exe
 * @returns {'create' | 'repair' | 'keep'}
 */
export function shortcutAction(currentTarget, execPath) {
  if (currentTarget === null || currentTarget === '') return 'create';
  return currentTarget === execPath ? 'keep' : 'repair';
}

/**
 * 首次运行补齐桌面快捷方式，并在版本目录变化后自愈。开发模式（execPath 是 electron.exe）与非 Windows 直接跳过。
 * 任何失败只记日志、不影响启动。
 * @returns {'create' | 'repair' | 'keep' | 'skip' | 'failed'}
 */
export function ensureDesktopShortcut({
  shell,
  app,
  execPath = process.execPath,
  platform = process.platform,
  log,
}) {
  if (platform !== 'win32' || !app.isPackaged) return 'skip';

  let link;
  try {
    link = path.join(app.getPath('desktop'), `${app.getName()}.lnk`);
  } catch (error) {
    log?.warn?.({ err: String(error) }, '桌面路径不可用，跳过快捷方式');
    return 'skip';
  }

  let currentTarget = null;
  try {
    currentTarget = shell.readShortcutLink(link).target ?? null;
  } catch {
    // 链接不存在或不是快捷方式：按"没有"处理
  }

  const action = shortcutAction(currentTarget, execPath);
  if (action === 'keep') return action;

  try {
    shell.writeShortcutLink(link, {
      target: execPath,
      cwd: path.dirname(execPath),
      icon: execPath,
      iconIndex: 0,
      description: app.getName(),
    });
    log?.info?.({ action }, '桌面快捷方式已就绪');
    return action;
  } catch (error) {
    log?.warn?.({ err: String(error) }, '创建桌面快捷方式失败');
    return 'failed';
  }
}
