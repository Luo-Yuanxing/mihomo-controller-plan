import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBinaryPath } from '../../src/util/paths.js';

function fakeAppDir(): string {
  const appDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-paths-'));
  mkdirSync(path.join(appDir, 'resources', 'bin'), { recursive: true });
  writeFileSync(path.join(appDir, 'resources', 'bin', 'mihomo.exe'), 'stub', 'utf8');
  return appDir;
}

describe('resolveBinaryPath', () => {
  it('相对路径按应用目录解析，并给出绝对路径', () => {
    const appDir = fakeAppDir();
    expect(resolveBinaryPath(appDir, 'resources/bin/mihomo.exe')).toBe(
      path.join(appDir, 'resources', 'bin', 'mihomo.exe'),
    );
  });

  it('绝对路径原样使用', () => {
    const appDir = fakeAppDir();
    const absolute = path.join(appDir, 'resources', 'bin', 'mihomo.exe');
    expect(resolveBinaryPath(appDir, absolute)).toBe(absolute);
  });

  it('空、不存在、是目录都报错', () => {
    const appDir = fakeAppDir();
    expect(() => resolveBinaryPath(appDir, '   ')).toThrow('内核路径不能为空');
    expect(() => resolveBinaryPath(appDir, 'resources/bin/nope.exe')).toThrow('不存在或不可读');
    expect(() => resolveBinaryPath(appDir, 'resources')).toThrow('不是文件');
  });
});
