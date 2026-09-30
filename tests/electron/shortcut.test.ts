import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureDesktopShortcut, shortcutAction } from '../../electron/shortcut.mjs';

const EXE = 'P:\\Program Files\\代理控制面板-1.0.2\\代理控制面板-1.0.2.exe';
const STALE_EXE = 'P:\\Program Files\\代理控制面板-1.0.1\\代理控制面板-1.0.1.exe';
const DESKTOP = 'C:\\Users\\x\\Desktop';

/** 假 shell / app：readShortcutLink 按 target 是否为 null 决定"链接不存在"还是"返回现有链接"。 */
function deps(target: string | null, packaged = true) {
  const links: Array<{ path: string; details: Record<string, unknown> }> = [];
  const shell = {
    readShortcutLink: vi.fn((link: string) => {
      if (target === null) throw new Error('ENOENT');
      expect(link).toBe(path.join(DESKTOP, '代理控制面板.lnk'));
      return { target };
    }),
    writeShortcutLink: vi.fn((link: string, details: Record<string, unknown>) => {
      links.push({ path: link, details });
      return true;
    }),
  };
  const app = {
    isPackaged: packaged,
    getName: () => '代理控制面板',
    getPath: () => DESKTOP,
  };
  return { shell, app, links };
}

describe('shortcutAction 快捷方式处置', () => {
  it('读不出链接就建，指向别的 exe 就修，指对了不动', () => {
    expect(shortcutAction(null, EXE)).toBe('create');
    expect(shortcutAction('', EXE)).toBe('create');
    expect(shortcutAction(STALE_EXE, EXE)).toBe('repair');
    expect(shortcutAction(EXE, EXE)).toBe('keep');
  });
});

describe('ensureDesktopShortcut 桌面快捷方式', () => {
  it('首次运行：桌面没有链接时创建，目标指向当前 exe', () => {
    const { shell, app, links } = deps(null);
    expect(ensureDesktopShortcut({ shell, app, execPath: EXE })).toBe('create');
    expect(links).toHaveLength(1);
    expect(links[0]?.path).toBe(path.join(DESKTOP, '代理控制面板.lnk'));
    expect(links[0]?.details).toMatchObject({
      target: EXE,
      cwd: path.dirname(EXE),
      icon: EXE,
      description: '代理控制面板',
    });
  });

  it('链接已指向当前 exe：不重写', () => {
    const { shell, app } = deps(EXE);
    expect(ensureDesktopShortcut({ shell, app, execPath: EXE })).toBe('keep');
    expect(shell.writeShortcutLink).not.toHaveBeenCalled();
  });

  it('链接指向旧版本目录：自愈到当前 exe', () => {
    const { shell, app, links } = deps(STALE_EXE);
    expect(ensureDesktopShortcut({ shell, app, execPath: EXE })).toBe('repair');
    expect(links[0]?.details).toMatchObject({ target: EXE });
  });

  it('开发模式与非 Windows 跳过，不碰桌面', () => {
    const dev = deps(null, false);
    expect(ensureDesktopShortcut({ shell: dev.shell, app: dev.app, execPath: EXE })).toBe('skip');
    expect(dev.shell.writeShortcutLink).not.toHaveBeenCalled();

    const other = deps(null);
    expect(
      ensureDesktopShortcut({
        shell: other.shell,
        app: other.app,
        execPath: EXE,
        platform: 'darwin',
      }),
    ).toBe('skip');
    expect(other.shell.writeShortcutLink).not.toHaveBeenCalled();
  });

  it('写入失败只记日志，不抛异常', () => {
    const { shell, app } = deps(null);
    shell.writeShortcutLink.mockImplementation(() => {
      throw new Error('磁盘拒绝写入');
    });
    const warn = vi.fn();
    expect(ensureDesktopShortcut({ shell, app, execPath: EXE, log: { warn } })).toBe('failed');
    expect(warn).toHaveBeenCalled();
  });
});
