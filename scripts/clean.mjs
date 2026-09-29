/**
 * 构建前清掉上一次的编译产物。
 * tsc 不会删除"源文件已经删掉"的历史输出（例如已废弃的 dist/proxy/watchdog.js），
 * 不清就会被打进发布包，所以每次 build 先全删。
 */
import { rmSync } from 'node:fs';

for (const target of ['dist', 'ui/dist']) {
  rmSync(target, { recursive: true, force: true });
}
