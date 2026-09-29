/**
 * 把打包产物同步到安装目录：P:\Program Files\<产品名>-<版本>。
 *
 * 安装目录名带版本号，所以版本一变目录名就得跟着变：脚本从 package.json 读版本，
 * 自己算出目录名，不再手改路径。目标目录已存在就原地增量覆盖（省掉拷 190MB 的
 * 大 exe——大小与时间都没变就跳过），不存在则整体拷过去并保留旧版本目录。
 *
 * 用法：
 *   node scripts/deploy.mjs            # 同步 release/win-unpacked → P:\Program Files\<名>-<版本>
 *   node scripts/deploy.mjs --dry      # 只报告会做什么
 *   node scripts/deploy.mjs --force    # 目标程序还在跑时自动结束它
 *   node scripts/deploy.mjs --dir D:\apps   # 换安装根目录
 *   node scripts/deploy.mjs --no-shortcut   # 不动桌面快捷方式
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry');
const force = argv.includes('--force');
const noShortcut = argv.includes('--no-shortcut');
const dirArg = argv.indexOf('--dir');

/** 安装根目录：默认 P:\Program Files，该盘不存在时退到用户级应用目录。 */
function resolveBaseDir() {
  if (dirArg >= 0 && argv[dirArg + 1] !== undefined) return path.resolve(argv[dirArg + 1]);
  const preferred = 'P:\\Program Files';
  try {
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    return path.join(process.env['LOCALAPPDATA'] ?? root, 'Programs');
  }
}

const version = String(pkg.version ?? '0.0.0');
const product = String(pkg.productName ?? pkg.name);
const source = path.join(root, 'release', 'win-unpacked');
const target = path.join(resolveBaseDir(), `${product}-${version}`);
const exeName = `${product}-${version}.exe`;
const exePath = path.join(target, exeName);
/** 桌面快捷方式固定用不带版本号的名字：升级换代时名字不变，不会出现"还写着旧版本号"的错觉。 */
const linkName = `${product}.lnk`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** 结束占用目标目录的程序：不关掉就改不动 exe（Windows 会拒绝写）。 */
function runningProcesses() {
  try {
    const output = execFileSync(
      'tasklist',
      ['/fi', `imagename eq ${exeName}`, '/fo', 'csv', '/nh'],
      { encoding: 'utf8', windowsHide: true },
    );
    return output
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.includes('INFO:'))
      .map((line) => line.split('","')[1] ?? '?');
  } catch {
    return [];
  }
}

function stopProcesses(pids) {
  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/pid', pid.trim(), '/t', '/f'], { windowsHide: true });
      process.stdout.write(`已结束占用程序：PID ${pid.trim()}\n`);
    } catch (error) {
      // 同一个进程树里的子进程会随父进程一起退出，轮到它时已经"不存在"：这不算失败
      const message = String(error);
      if (/not found|找不到/i.test(message)) {
        process.stdout.write(`PID ${pid.trim()} 已随父进程退出\n`);
        continue;
      }
      fail(`结束 PID ${pid.trim()} 失败：${message}`);
    }
  }
}

/** 逐文件比对大小与修改时间，只拷需要更新的文件，并把统计交给调用方。 */
function syncTree(from, to, stats, relative = '') {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    const rel = path.join(relative, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(toPath)) {
        stats.added += 1;
        if (!dryRun) fs.mkdirSync(toPath, { recursive: true });
      }
      syncTree(fromPath, toPath, stats, rel);
      continue;
    }

    const current = fs.existsSync(toPath) ? fs.statSync(toPath) : null;
    if (current !== null) {
      const next = fs.statSync(fromPath);
      if (current.size === next.size && current.mtimeMs >= next.mtimeMs) {
        stats.same += 1;
        continue;
      }
      stats.updated += 1;
      stats.updatedFiles.push(rel);
    } else {
      stats.added += 1;
    }
    if (!dryRun) fs.copyFileSync(fromPath, toPath);
  }
}

/**
 * 桌面快捷方式的映射：目标目录带版本号，快捷方式也要跟着换，否则旧版被删后就是死链。
 * 用 PowerShell 的 WScript.Shell 读写 .lnk，并顺路清掉指向已卸载版本的死链。
 */
function desktopDir() {
  const fromEnv = process.env['USERPROFILE'];
  const desktop = path.join(fromEnv ?? '', 'Desktop');
  if (fs.existsSync(desktop)) return desktop;
  return path.join(process.env['PUBLIC'] ?? 'C:\\Users\\Public', 'Desktop');
}

function desktopLinks() {
  const dir = desktopDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /代理控制面板|mihomo/i.test(name) && /\.lnk$/i.test(name));
}

/** 读一条 .lnk 的目标与工作目录（按 \t 分隔返回，避免中文编码问题）。 */
function readLink(linkPath) {
  const script = [
    '$sh = New-Object -ComObject WScript.Shell',
    `$s = $sh.CreateShortcut(${quote(linkPath)})`,
    '[Console]::Out.Write("$($s.TargetPath)`t$($s.WorkingDirectory)")',
  ].join('; ');
  const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const [linkTarget = '', working = ''] = output.split('\t');
  return { target: linkTarget, working };
}

function quote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/** 打开（或重新指向）桌面快捷方式；改名用临时脚本写，参数全部经 base64 传递，避免中文被代码页吃掉。 */
function writeLink(linkPath, iconSource) {
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($payload.link)
$s.TargetPath = $payload.exe
$s.WorkingDirectory = $payload.work
if ($payload.icon -ne '' -and (Test-Path $payload.icon)) { $s.IconLocation = "$($payload.icon),0" }
$s.Description = $payload.name
$s.Save()
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const payload = JSON.stringify({
    link: linkPath,
    exe: exePath,
    work: target,
    name: product,
    icon: iconSource,
  });
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input: payload,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function updateShortcuts() {
  const links = desktopLinks();
  const preferred = path.join(desktopDir(), linkName);
  // 已有不带版本号的快捷方式就以它为模板，其次才找指向当前版本的旧命名
  const source =
    links.find((name) => path.join(desktopDir(), name) === preferred) ??
    links.find((name) => readLink(path.join(desktopDir(), name)).target === exePath);
  const template = path.join(desktopDir(), source ?? linkName);

  for (const name of links) {
    const linkPath = path.join(desktopDir(), name);
    const { target: linkTarget, working } = readLink(linkPath);
    if (linkTarget === exePath) continue;
    const stale = linkTarget === '' || !fs.existsSync(linkTarget);
    if (stale) {
      // 指向的版本已经不在了，这条是死链，留着只会在桌面上越攒越多
      process.stdout.write(`  删除死链快捷方式：${name}\n`);
      if (!dryRun) fs.rmSync(linkPath, { force: true });
      continue;
    }
    if (!/代理控制面板/.test(linkTarget)) continue;
    process.stdout.write(`  快捷方式换版本：${name}\n    ${linkTarget} → ${exePath}\n`);
    if (!dryRun) writeLink(linkPath, working === '' ? '' : path.join(working, 'tray.png'));
  }

  if (fs.existsSync(template) || (source !== undefined && fs.existsSync(exePath))) {
    process.stdout.write(`  桌面快捷方式就位：${path.basename(template)}\n`);
    if (!dryRun) writeLink(template, '');
  }
}

if (!fs.existsSync(source)) fail(`没有找到打包产物：${source}\n请先执行 npm run dist`);

const already = runningProcesses();
if (already.length > 0) {
  if (!force) {
    fail(`目标程序正在运行（PID ${already.join(', ')}）：先关掉它，或加 --force 让脚本自动结束。`);
  }
  if (!dryRun) stopProcesses(already);
}

const stats = { added: 0, updated: 0, same: 0, updatedFiles: [] };
process.stdout.write(
  `${dryRun ? '[dry-run] ' : ''}同步打包产物 → 安装目录\n  产物：${source}\n  安装：${target}\n`,
);

if (!dryRun) fs.mkdirSync(target, { recursive: true });
syncTree(source, target, stats);

const listing = fs.existsSync(target) ? fs.readdirSync(target) : [];
process.stdout.write(
  `  新增 ${String(stats.added)} 个，更新 ${String(stats.updated)} 个，跳过 ${String(stats.same)} 个\n`,
);
for (const line of stats.updatedFiles.slice(0, 10)) process.stdout.write(`    ~ ${line}\n`);
if (stats.updatedFiles.length > 10) {
  process.stdout.write(`    …等 ${String(stats.updatedFiles.length)} 个文件有变化\n`);
}

if (dryRun) {
  process.stdout.write('dry-run 结束，未改动任何文件。\n');
} else {
  if (!listing.includes(exeName)) fail(`同步后没找到主程序：${exePath}`);
  process.stdout.write(`完成：${exePath}\n`);
}

if (!noShortcut && !dryRun && fs.existsSync(exePath)) updateShortcuts();
