/**
 * 原子写：写临时文件 → rename 覆盖。
 * 计划 §4.3 读写约定。
 */
import fs from 'node:fs';
import path from 'node:path';

export async function writeFileAtomic(targetPath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  await fs.promises.rename(tmpPath, targetPath);
}

export async function readFileIfExists(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
