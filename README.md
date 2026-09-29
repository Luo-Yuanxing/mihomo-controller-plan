# mihomo-controller-plan（代理控制面板）

完整需求与设计见 [mihomo-controller-plan.md](./mihomo-controller-plan.md)。

## 快速开始

```bash
npm install
npm run dev        # 前端 + 后端
npm test           # Vitest
npm run dist       # electron-builder 产出免安装文件夹
```

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/` | Node 侧：REST、内核托管、订阅、规则、配置渲染 |
| `ui/` | React 前端（规则 / 失败连接 / 状态 / 设置） |
| `electron/` | Electron 壳，托盘常驻 |
| `resources/bin/` | 随包分发的 mihomo.exe（需自行放入，不入库） |
| `data/` | 唯一可写区，运行时数据全在这里 |

## 数据目录定位

1. 环境变量 `MCP_DATA_DIR`
2. exe 同级 `data/`（可写时）
3. 回退 `%LOCALAPPDATA%\mihomo-controller-plan\data`

## 安全使用

系统代理是 Windows 的用户级设置（`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`），
它把流量指向内核的混合端口。**内核没在跑而这个开关还开着 = 所有遵守它的程序都被送去一个没人监听的端口**，
表现就是"断网、但面板自己还能开"（面板走直连，不受影响）。

规矩只有一条：**退出必须走有清理的路径。**

| 做法 | 结果 |
| --- | --- |
| 托盘菜单「安全退出（先关闭系统代理）」 | 先关代理 → 停内核 → 退出 ✅ |
| 状态页「安全关闭应用」 | 同上 ✅ |
| 任务管理器结束进程 / 终端 Ctrl+C / 关终端窗口 | Windows 强杀不给清理机会，代理残留 ❌ |

残留了别慌，按顺序恢复：

1. 状态页「一键关闭代理」——直接把系统代理关掉，先恢复上网；
2. 状态页「一键修复」——重写 `config.yaml` → 内核没起来就启动 → 内核就绪才写回系统代理；
   **内核起不来时它会自动关掉代理**，不会把你留在断网状态；
3. 后端已经起不来（页面进离线态）时用面板顶部的离线兜底按钮，或手动改注册表：

```bat
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f
```

「一键打开代理 / 一键关闭代理」就是系统代理的开关本身：打开会把当前期望值写进注册表并纳入守护，
关闭会把控制权交还给你（不再回写）。

