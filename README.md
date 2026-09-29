# mihomo-controller-plan（代理控制面板）

完整需求与设计见 [mihomo-controller-plan.md](./mihomo-controller-plan.md)。

## 快速开始

```bash
npm install
npm run dev        # 前端 + 后端（开发）
npm test           # Vitest
npm run dist       # 产出 release/ 下的免安装目录与 zip
```

## 构建产物（v1.0.0）

| 产物 | 说明 |
| --- | --- |
| `release/代理控制面板-1.0.0-x64.zip` | 免安装压缩包，解压即用（约 151 MB，含 mihomo.exe 与 geo 数据） |
| `release/win-unpacked/代理控制面板-1.0.0.exe` | 免安装目录里的主程序，exe 名带版本号，多版本可并存 |

- 版本号只改 `package.json` 一处：zip 名按 `artifactName` 模板带版本，**exe 名的版本后缀由 `scripts/after-pack.cjs` 补**——electron-builder 的 `win.executableName` 不展开 `${version}` 宏。
- `npm run build` 会先跑 `scripts/clean.mjs` 清空 `dist/` 与 `ui/dist/`：tsc 不删除源文件已删的历史输出，不清会被原样打进包。
- 随包分发 `resources/bin/mihomo.exe`、`resources/geo/`；界面常量与应用设置同住在应用根目录的 `config.json`（首次启动自动生成），开发机的订阅与密钥不进包。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/` | Node 侧：REST、内核托管、订阅、规则、配置渲染 |
| `ui/` | React 前端（规则 / 失败连接 / 状态 / 设置） |
| `electron/` | Electron 壳，托盘常驻 |
| `resources/bin/` | 随包分发的 mihomo.exe（需自行放入，不入库） |
| `config.json` | 工作目录下的唯一配置文件：界面常量 + 内核/订阅/系统代理期望值 |
| `data/` | 唯一可写区，运行时数据全在这里 |

## 数据目录定位

1. 环境变量 `MCP_DATA_DIR`
2. exe 同级 `data/`（可写时）
3. 回退 `%LOCALAPPDATA%\mihomo-controller-plan\data`

## 配置文件

界面常量与应用设置（内核路径、混合端口、订阅、系统代理期望值）同住在工作目录的 `config.json`：
开发期是仓库根，打包后是 exe 同级；该目录不可写时退回数据目录。首次启动自动生成，可以直接手改，
界面上的"强制按配置文件加载"就是按它覆盖生效值。
界面里"配置文件路径"那一栏也存在这个文件的 `configFile` 字段里（默认就是它自己），重启后还是上次的值。

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

