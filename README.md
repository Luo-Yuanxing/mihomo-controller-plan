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
| `ui/` | React 前端（规则 / 状态 / 设置 3 页） |
| `electron/` | Electron 壳，托盘常驻 |
| `resources/bin/` | 随包分发的 mihomo.exe（需自行放入，不入库） |
| `data/` | 唯一可写区，运行时数据全在这里 |

## 数据目录定位

1. 环境变量 `MCP_DATA_DIR`
2. exe 同级 `data/`（可写时）
3. 回退 `%LOCALAPPDATA%\mihomo-controller-plan\data`
