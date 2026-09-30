# mihomo-controller-plan（代理控制面板）

Windows 上的 mihomo 图形控制面板：**内核托管 + 订阅下载 + 规则热更新 + 系统代理守护**，托盘常驻，关掉窗口不断网。

完整需求与设计见 [mihomo-controller-plan.md](./mihomo-controller-plan.md)。

## 能做什么

| 能力 | 说明 |
| --- | --- |
| 内核托管 | 拉起 / 监视 / 重启 `mihomo.exe`，进程退出、配置预检失败都有明确状态与日志 |
| 订阅 | 按 URL 下载 YAML → 原子写入 `data/subscription.yaml` → 内核以 `file` 类型 provider 使用；**URL 改成新的非空值并保存时自动下一份**，状态页也可随时手动刷新 |
| 规则热更新 | SQLite 规则库 + 拖拽排序 + 启停，改动即时合成 provider 并热更新，不断现有连接 |
| 失败连接 | 从内核日志 + 连接快照合并出"连不上/零回程"的目标，可一键加进规则或黑名单 |
| 系统代理守护 | 内核就绪就指向它，内核不可用就自动关掉，避免"整机断网但面板还能开" |
| 界面语言 | 中文 / English，界面、后端提示、托盘菜单一起切 |
| 配置搬运 | 一份 Base64 字符串在面板之间传界面常量 + 规则 + 内核路径（不含订阅与 secret） |

## 快速开始

前置：**Windows 10/11 x64**、**Node.js ≥ 22**，以及一份 mihomo 内核（见下）。

```bash
npm install
npm run dev            # 前端（5173）+ 后端（8787）+ Electron 壳一起起
npm test               # Vitest：130 个用例
npm run lint           # ESLint
npm run typecheck      # tsc：Node 侧 + UI 侧
npm run dist           # 产出 release/ 下的免安装目录与 zip
```

内核二进制不入库（体积大、且各人用的版本不同），构建前放到：

```
resources/bin/mihomo.exe
resources/geo/{Country.mmdb,geoip.dat,geosite.dat}
```

开发期只想跑后端也可以：`npm run dev:server`（REST 挂在 `127.0.0.1:8787`，Vite 已把 `/api` 代理过去）。

## 构建产物（v1.0.3）

| 产物 | 说明 |
| --- | --- |
| `release/代理控制面板-1.0.3-x64.zip` | 免安装压缩包，解压即用（约 151 MB，含 mihomo.exe 与 geo 数据） |
| `release/win-unpacked/代理控制面板-1.0.3.exe` | 免安装目录里的主程序，exe 名带版本号，多版本可并存 |

- 版本号只改 `package.json` 一处：zip 名按 `artifactName` 模板带版本，**exe 名的版本后缀由 `scripts/after-pack.cjs` 补**——electron-builder 的 `win.executableName` 不展开 `${version}` 宏。
- 版本号还会写进 `src/version.ts`（`npm run gen:version`，开发与构建前都跑）：界面上的"应用版本号"取自这里，手改该文件没有意义。
- `npm run build` 会先跑 `scripts/clean.mjs` 清空 `dist/` 与 `ui/dist/`：tsc 不删除源文件已删的历史输出，不清会被原样打进包。
- 随包分发 `resources/bin/mihomo.exe`、`resources/geo/`；界面常量与应用设置同住在应用根目录的 `config.json`（首次启动自动生成），开发机的订阅与密钥不进包。
- `npm run deploy` 可把 `release/win-unpacked/` 同步到安装目录并维护桌面快捷方式，参数见 `scripts/deploy.mjs` 顶部注释。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/` | Node 侧：REST、内核托管、订阅、规则、配置渲染 |
| `ui/` | React 前端（规则 / 失败连接 / 状态 / 设置） |
| `electron/` | Electron 壳，托盘常驻 |
| `tests/` | Vitest：路由、订阅、规则、系统代理、i18n、UI 纯函数 |
| `scripts/` | 版本号生成、清理、内核校验、打包后处理、部署 |
| `resources/bin/` | 随包分发的 mihomo.exe（需自行放入，不入库） |
| `config.json` | 工作目录下的唯一配置文件：界面常量 + 内核/订阅/系统代理期望值 + 初始化标记（加载时即为 false） |
| `data/` | 唯一可写区，运行时数据全在这里 |

## 数据目录定位

1. 环境变量 `MCP_DATA_DIR`
2. exe 同级 `data/`（可写时）
3. 回退 `%LOCALAPPDATA%\mihomo-controller-plan\data`

日志（`logs/app.log`、`logs/core.log`）、订阅原文、规则库、运行期锁文件都在这里，删掉整个 `data/` 相当于恢复出厂。

## 配置文件

界面常量与应用设置（内核路径、混合端口、订阅、系统代理期望值）同住在工作目录的 `config.json`：
开发期是仓库根，打包后是 exe 同级；该目录不可写时退回数据目录。首次启动自动生成，可以直接手改，
文件操作对用户透明——不用自己挑路径，也不用导入导出文件。

界面语言也在同一个文件里：`language` 只有 `zh`（默认）与 `en` 两种，界面、后端返回的提示、
托盘菜单与对话框都跟着它走；在设置页切换即可，也可以直接改文件。

设置页只需 **保存设置** 一处落盘：内核路径、混合端口、订阅 URL / User-Agent / 是否走本机代理
与系统代理期望值一起写回，订阅 URL 变了会顺手下载（见上表）。

## 首次使用

1. 启动程序，打开面板（默认 `http://127.0.0.1:8787`，托盘图标可再打开）。
2. 设置页填订阅 URL（必要时打开"下载走本机代理"、改 User-Agent），点 **保存设置**——订阅会自动下载。
3. 状态页确认内核状态为运行中、订阅字节数与更新时间正常；代理组与出口在这里选。
4. 规则页按需加规则，保存即热更新；失败连接页看到连不上的目标可一键加规则。

## 导入设置

配置靠一份 **Base64 字符串**在面板之间传递，界面只有两种加载方式：

| 方式 | 做什么 |
| --- | --- |
| 导入字符串 | 粘贴别处生成的配置串：界面常量、自定义规则、内核路径与系统代理期望值一起生效 |
| 立即初始化 | 什么都不导入，直接把 `initialized` 落成 false，沿用当前内容 |

`initialized` 默认就是 false：新装预生成的 `config.json`、以及加载时读到的旧文件（`true`）都会被落成 false，
所以启动不做初始化引导、不自动跳设置页，界面直接按文件生效；内核与系统代理照常启动，不受影响。

分享串里不含订阅（URL / User-Agent / 下载设置）也不含内核 secret——订阅链接是私人凭据，不外传；
导入时订阅一律保持本机现状。

## REST 接口

只监听 `127.0.0.1`；设置 `MCP_API_TOKEN` / 传入 `apiToken` 后，所有 `/api/*` 请求都要带 `X-Api-Token`。
完整清单与字段见 [mihomo-controller-plan.md](./mihomo-controller-plan.md) §6，常用几组：

| 分组 | 端点 |
| --- | --- |
| 状态与自救 | `GET /api/status`、`GET /api/ping`、`POST /api/recover`、`POST /api/offline/{shutdown,restart}` |
| 设置 | `GET /api/settings`、`PUT /api/settings`（订阅 URL 变更时自动下载） |
| 订阅 | `GET /api/subscription/groups`、`POST /api/subscription/refresh`、`DELETE /api/subscription` |
| 规则 | `GET/POST /api/rules`、`PUT/DELETE /api/rules/:id`、`PUT /api/rules/order`、`POST /api/rules/sync` |
| 代理 | `GET /api/proxies`、`PUT /api/proxies/:group`、`GET /api/proxies/:group/delay`、`POST /api/proxy/{enable,disable}` |
| 内核 | `POST /api/kernel/{start,stop,restart}` |
| 诊断 | `GET /api/failed-connections`、`GET /api/blacklist`、`PUT /api/blacklist`、`GET /api/logs`、`GET /api/config` |
| 界面常量 | `GET /api/ui-config`、`GET /api/ui-config/share`、`POST /api/ui-config/import`、`POST /api/ui-config/initialize` |

## 测试与 CI

- 单元/接口测试用 Vitest，只跑在 Node 上（不需要 Electron）：`npm test`
- 路由测试用 `fastify.inject()`，不占端口；订阅、规则渲染、i18n 表完整性都有覆盖
- [.github/workflows/ci.yml](./.github/workflows/ci.yml) 在 `windows-latest` 上跑 lint → typecheck → test

## 安全使用

系统代理是 Windows 的用户级设置（`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`），
它把流量指向内核的混合端口。**内核没在跑而这个开关还开着 = 所有遵守它的程序都被送去一个没人监听的端口**，
表现就是"断网、但面板自己还能开"（面板走直连，不受影响）。

程序按这个方向做了联动：**内核就绪（运行中或已接管）→ 自动打开系统代理并指向它；内核停止、崩溃或启动失败 → 自动关闭系统代理**，交还控制权。
反向不成立：在界面上开关系统代理不会启动或停止内核。

规矩只有一条：**退出必须走有清理的路径。**

| 做法 | 结果 |
| --- | --- |
| 托盘菜单「安全退出（先关闭系统代理）」 | 先关代理 → 停内核 → 退出 ✅ |
| 状态页「安全关闭应用」 | 同上 ✅ |
| 任务管理器结束进程 / 终端 Ctrl+C / 关终端窗口 | Windows 强杀不给清理机会，代理残留 ❌ |

残留了别慌，按顺序恢复：

1. 状态页「关闭系统代理」——直接把系统代理关掉，先恢复上网；
2. 状态页「一键修复」——重写 `config.yaml` → 内核没起来就启动 → 内核就绪才写回系统代理；
   **内核起不来时它会自动关掉代理**，不会把你留在断网状态；
3. 后端已经起不来（页面进离线态）时用面板顶部的离线兜底按钮，或手动改注册表：

```bat
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f
```

「开启系统代理 / 关闭系统代理」就是系统代理的开关本身，守护跟着开关走（没有单独的守护开关）：
开启会把当前期望值写进注册表并纳入守护（每 60 s 巡检回写），关闭会把控制权交还给你（不再回写）。
