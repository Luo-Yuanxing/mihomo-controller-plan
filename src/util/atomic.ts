/**
 * 原子写：写临时文件 → rename 覆盖。
 * 计划 §4.3 读写约定。
 */
export async function writeFileAtomic(_targetPath: string, _content: string): Promise<void> {
  throw new Error('未实现：原子写文件');
}
