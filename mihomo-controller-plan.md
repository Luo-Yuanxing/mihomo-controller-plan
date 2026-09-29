# mihomo-controller-plan（代理控制面板）—— 项目计划

| 项目项 | 内容 |
| --- | --- |
| 应用名 | mihomo-controller-plan |
| 中文显示名 | 代理控制面板 |
| 文档版本 | v3.0 |
| 日期 | 2026-09-29 |
| 平台 | Windows 10/11 x64 |
| 内核 | mihomo（Clash.Meta） |
| 交付形态 | 免安装文件夹版，双击文件夹内 exe 启动，托盘常驻后台 |

---

## 1. 概述

### 1.1 要解决的问题

订阅只有一份且长期不变，自定义规则却高频改动。Clash Verge 只能靠图形操作，改规则要保存、重新合成、重载内核，还可能断连接，也无法被脚本调用。

### 1.2 目标

1. 订阅只有一份，由程序按 URL 下载成文件，内核作为 `file` 类型 provider 使用。
2. 规则存进数据库（唯一使用数据库的地方），高频增删改不丢数据。
3. 规则改动生成 rule-provider 文件后 `PUT /providers/rules/{name}` 热更新，**不重启内核、不断连接**。
4. 只维护当前这一份数据，不做版本历史；进程遇到环境类异常就停止工作，不做自动恢复。
5. 打成免安装文件夹分发，双击文件夹里的 exe 启动；窗口关闭即隐藏到托盘，误关程序不会断网。
6. 数据目录放在应用文件夹内，运行时文件随时可读写、可备份、可整体搬走。

### 1.3 成功标准

| 编号 | 指标 | 目标 |
| --- | --- | --- |
| S1 | 单次规则热更新耗时（1000 条内） | ≤ 300 ms，连接不中断 |
| S2 | 界面保存到规则生效 | ≤ 1 s |
| S3 | 冷启动到可代理 | ≤ 5 s（含首次下载订阅） |
| S4 | 配置错误导致代理中断 | 0 次（应用前必须过 `mihomo -t`） |
| S5 | 系统代理被外部改写后的恢复 | ≤ 60 s |
| S6 | 系统代理写入方式 | 直接覆盖注册表三项，不备份、不还原 |
| S7 | 第二个实例 | 立即退出并唤起已有窗口 |
| S8 | 异常行为 | 立即停止并留下可读错误，不做静默重试 |
| S9 | 关闭窗口后 | 代理继续工作，系统代理设置保持不变 |
| S10 | 任务管理器结束主进程后 | 内核继续运行、系统代理保持，网络不中断；再次双击可接管 |

---

## 2. 功能清单

下表 13 项是本版要做的全部功能，表外的一律不做。

| 编号 | 功能 | 说明 |
| --- | --- | --- |
| FR-01 | 单实例运行 | 文件锁；重复启动即唤起已有窗口 |
| FR-02 | 订阅下载 | 按 URL 下载 YAML，校验含 `proxies`/`proxy-providers`，原子写入 `data/subscription.yaml` |
| FR-03 | 订阅刷新 | 只手动触发，不做定时自动刷新；失败保留旧文件并报错 |
| FR-04 | 内核托管 | 启动、就绪探测、退出清理；内核作为独立进程运行，不随窗口关闭而结束 |
| FR-05 | 配置生成与预检 | 模板渲染 `config.yaml`，应用前 `mihomo -t` 校验 |
| FR-06 | 规则存储 | SQLite 单表，支持高频增删改 |
| FR-07 | 规则热更新 | 生成 rule-provider 文件 → `PUT /providers/rules/{name}` |
| FR-08 | 系统代理开关 | 开启/关闭，直接覆盖注册表三项，不做备份与还原 |
| FR-09 | 系统代理守护 | 每 60 s 轮询一次，被改写即回写 |
| FR-10 | 日志 | 后端与内核日志落盘，界面可看最近若干行 |
| FR-11 | 极简界面 | 规则页、状态页、设置页 |
| FR-12 | 托盘常驻与退出保护 | 关闭窗口只隐藏到托盘；退出必须走托盘菜单并二次确认；主进程被误杀时内核与系统代理保持不动 |
| FR-13 | 出错即停 | 环境类异常时应用自身停止，但已启动的内核与系统代理保持现状，避免断网 |

---

## 3. 技术选型

| 层次 | 方案 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 22 LTS | — |
| 后端 | Fastify + Zod | 校验直接复用 schema |
| 数据库 | better-sqlite3 | 同步 API，仅用于规则表 |
| 前端 | React + Vite + TypeScript | — |
| UI | Tailwind CSS + shadcn/ui | 只做 3 个页面：规则页、状态页、设置页 |
| 数据请求 | TanStack Query | 缓存与刷新策略 |
| 桌面壳 | Electron | 主进程即 Node |
| 日志 | pino | 结构化 + 轮转 |
| 测试 | Vitest | 单元与接口测试 |
| 打包 | electron-builder（免安装文件夹） | 输出解压即用的目录；不做单文件打包、安装包、签名与自动更新 |

### 3.1 数据存放约定

| 数据 | 存放 | 说明 |
| --- | --- | --- |
| 规则 | SQLite `data/rules.db` | 唯一使用数据库的地方，高频写入不丢 |
| 订阅内容 | 文件 `data/subscription.yaml` | 下载结果，内核以 `file` 类型 provider 读取 |
| 设置与界面常量（订阅 URL、端口、内核路径、界面选项等） | 文件 `config.json`（工作目录，不可写时退回 `data/`） | 一个文件装完，界面与手改都改它 |
| 配置怎么进到新机器 | Base64 分享串（界面"导入设置"） | 只有字符串导入与立即初始化两种加载方式，不做文件导入导出；分享串不含订阅与 secret |
| 是否已配置 | `config.json` 的 `initialized` | 默认 false = 启动即按文件生效；加载时读到 true（旧文件）会落成 false，不做初始化引导 |
| 生成物 | 文件 `data/config.yaml`、`data/rules/*.yaml` | 由程序生成，可随时重建 |

## 4. 架构

### 4.1 进程模型

```
双击 mihomo-controller-plan.exe
      │
┌─────▼─────────────────────────────────────────┐
│ Electron 主进程 = 后台常驻程序                  │
│  订阅下载 / 内核守护 / 规则热更新 / REST / 守护 │
│  窗口关掉后本进程继续运行（托盘图标常驻）        │
└───────┬───────────────────────────┬───────────┘
        │ 独立子进程                 │ 静态资源 + REST
┌───────▼────────┐        ┌─────────▼──────────┐
│ mihomo 内核     │        │ 窗口（React 3 页） │
│ 不随窗口关闭结束│        │ 可随时关闭/重开     │
└────────────────┘        └────────────────────┘
```

三层各自的存活关系：

| 对象 | 关闭窗口时 | 主进程被误杀时 | 托盘菜单退出时 |
| --- | --- | --- | --- |
| 窗口 | 隐藏到托盘 | 消失 | 关闭 |
| 主进程（后台程序） | 继续运行 | 结束 | 结束 |
| mihomo 内核 | 继续运行 | **继续运行** | 结束 |
| 系统代理设置 | 不变 | **不变** | 不变 |

只有双击 exe 一种启动方式，不提供命令行启动，也不注册开机自启。主进程结束后内核仍作为独立进程存活。

### 4.2 数据流

**订阅下载（启动时缺失才下载 + 手动刷新）**

```
URL（可选走本机代理）→ GET，带 UA 与超时 → 校验是 YAML 且含 proxies
→ 写 tmp → rename 覆盖 data/subscription.yaml
→ PUT /providers/proxies/sub-main（file provider 重新读取）
```

**规则热更新（高频路径）**

```
界面/脚本 → REST → 写 SQLite → 渲染 rule-provider 文件
→ 原子落盘 → PUT /providers/rules/custom → 生效
```

**系统代理守护（低频）**

```
每 60 s：读注册表三项 → 与期望值比对 → 不一致则回写 → 记日志
```

### 4.3 目录结构

**开发期源码结构**

```
mihomo-controller-plan/
├─ src/
│  ├─ server.ts            入口：REST + 静态资源 + 启动流程
│  ├─ core/
│  │  ├─ manager.ts        内核进程：启动/探活/退出
│  │  ├─ api.ts            内核 REST 客户端
│  │  └─ validate.ts       mihomo -t 预检
│  ├─ sub/download.ts      订阅下载与校验
│  ├─ sub/subscription.ts  订阅文件解析：节点数 / 代理组 / dns
│  ├─ rules/
│  │  ├─ db.ts             SQLite 连接与建表
│  │  ├─ repo.ts           规则增删改查
│  │  ├─ render.ts         规则 → provider yaml
│  │  └─ sync.ts           原子落盘 + 热更新
│  ├─ config/template.ts   配置模板渲染
│  └─ util/                锁文件、原子写、日志
├─ ui/                     React 前端（3 页）
├─ electron/main.js        壳
├─ config.json             统一配置：界面常量 + 内核/订阅/系统代理（工作目录，可手改）
└─ data/                   运行时数据（开发期与打包后同名）
   ├─ config.yaml
   ├─ subscription.yaml
   ├─ rules.db
   ├─ rules/
   ├─ logs/
   └─ run/                 进程锁
```

**打包后的应用文件夹（用户实际拿到的）**

```
mihomo-controller-plan/
├─ mihomo-controller-plan.exe   主程序，双击启动
├─ config.json                  统一配置：界面常量 + 内核/订阅/系统代理期望值（可手改）
├─ resources/
│  ├─ app.asar                  前后端代码（只读，不写）
│  └─ bin/mihomo.exe            内核（随包分发，也允许在设置里换成自己的路径）
├─ data/                        唯一可写区，运行时文件全在这里
│  ├─ subscription.yaml         下载到的订阅原文
│  ├─ rules.db                  SQLite 规则库
│  ├─ config.yaml               生成的 mihomo 配置
│  ├─ rules/custom.yaml         生成的 rule-provider
│  ├─ logs/                     app.log / core.log
│  └─ run/                      app.lock
├─ README.txt                   一页说明：怎么启动、数据在哪、怎么备份
└─ 卸载.txt                     绿色版：删掉整个文件夹即可
```

**为什么不做单文件**：规则库和订阅文件是持续写入的，日志还要按天轮转；单文件打包会把程序自身解压到临时目录，运行时数据的路径与生命周期都难以控制，排查问题也不方便。文件夹版所有可写文件集中在 `data/`，用户能直接看到、备份、替换。

**数据目录定位规则**（按顺序判断，只做一次，不搞复杂探测）

1. 环境变量 `MCP_DATA_DIR` 指定了路径 → 用它。
2. exe 同级 `data/` 可写 → 用它（默认情况，解压到 D 盘、桌面等任意目录都成立）。
3. 都不行（例如被解压到 `C:\Program Files` 下）→ 回退到 `%LOCALAPPDATA%\mihomo-controller-plan\data`，并在界面顶部提示数据实际位置。

**读写约定**

- 全部运行数据只走 `data/`，绝不写程序目录与注册表（系统代理三项除外，那是 Windows 的系统设置）。
- 订阅、生成配置、rule-provider 一律"写临时文件 → rename 覆盖"，避免半截文件。
- `data/` 整个复制到另一台机器即可接管，路径不写死。

### 4.4 单实例

| 层 | 机制 | 冲突时行为 |
| --- | --- | --- |
| 应用 | `data/run/app.lock` 文件锁 | 提示已在运行并退出 |
| 界面 | `app.requestSingleInstanceLock()` | 重复双击时唤起已有窗口 |
| 内核 | 固定端口绑定（探测到已有内核在跑就接管） | 报错退出，不换端口 |

端口固定：mixed `7890`（可改）、controller `9090`（不给改）。被占用时报错写明端口与 PID，不做迁移。

### 4.5 出错即停（fail-stop）

| 分类 | 例子 | 行为 |
| --- | --- | --- |
| 环境类异常 | 内核启动失败或中途退出、端口被占用、数据库打不开、注册表写入失败、锁文件拿不到 | 记录错误 → 停止工作 → 非零退出码 |
| 输入类错误 | 规则格式不合法、订阅下载失败、URL 无 `proxies` 字段 | 返回错误信息，进程继续运行 |

原则：不做重试、不做退避、不做自动恢复。宁可停下并留下清晰原因，也不要带着不确定状态继续跑。

例外：停止的只是应用自身。内核进程与系统代理设置保持不动，用于兜住"误关程序就断网"这个风险。

---

## 5. 模块设计

### 5.1 订阅（单份）

| 项 | 设计 |
| --- | --- |
| 配置 | `config.json` 的 `subscription: { url, useProxy, userAgent, proxyGroup }` |
| 下载 | `fetch` GET，默认 20 s 超时，默认 UA `clash-verge/v3`（可覆盖），可选走本机 mixed 端口或系统代理 |
| 校验 | 状态码 2xx；剥 BOM；YAML 可解析；含 `proxies` 或 `proxy-providers` |
| 落盘 | 写 `subscription.yaml.tmp` → `rename` 覆盖，再 `PUT /providers/proxies/sub-main` |
| 失败 | 保留旧文件并返回错误；首次启动时失败则直接停止 |
| 刷新 | 只有手动触发（状态页"刷新订阅"）；不装定时器，避免后台悄悄换节点 |
| PROXY 指代 | `proxyGroup` 空 = `PROXY` 组用订阅全部节点；非空 = 按订阅里同名组复刻（类型、url 等原样带过，节点仍由 provider 提供，组引用递归生成）。找不到该组就回退成全部节点；改这里会立即重建代理组（重启内核），否则界面列的还是旧组的节点 |

内核侧配置成文件 provider，避免"访问订阅域名本身需要代理"的自举问题：

```yaml
proxy-providers:
  sub-main:
    type: file
    path: ./subscription.yaml
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204
      interval: 300
```

### 5.2 内核托管

| 能力 | 设计 |
| --- | --- |
| 启动 | `spawn(bin, ['-d', dir, '-f', config, '-ext-ctl', '127.0.0.1:9090', '-secret', S], { windowsHide: true })`，stdout/stderr 收进日志 |
| 内核路径 | `config.json` 的 `core.binaryPath` 存绝对路径：保存时按"绝对路径 → 应用目录 → 打包后的 resources 目录"解析并校验存在，失败直接 400；运行时换路径下次 start/restart 生效 |
| 就绪探测 | 轮询 `GET /version`，超时 15 s 视为失败并附日志尾部，随后停止 |
| 运行期 | 每 10 s 探活；发现内核退出则记录退出码与日志尾部后停止工作 |
| 存活关系 | 内核不随窗口关闭结束；只有托盘菜单"退出"才结束它 |
| 重复双击 | 启动时探测控制端口：已有内核在跑则直接接管，不重复启动 |
| 退出 | 走托盘菜单退出时触发 `-post-down` 清理；超时后强杀进程树 |
| 版本 | 解析 `-v` 记录版本与构建 tag |

### 5.3 规则存储（SQLite）

```sql
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  position    INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  type        TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  policy      TEXT    NOT NULL,
  no_resolve  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rules_position ON rules(position);
```

字段说明：`type` 为规则类型（DOMAIN / DOMAIN-SUFFIX / IP-CIDR / GEOIP / RULE-SET / MATCH 等），`policy` 为目标（策略组名 / DIRECT / REJECT）。

- 单表，启动时 `CREATE TABLE IF NOT EXISTS`，不做迁移、不做版本表。
- 写操作走事务；批量导入用单个事务，保证不丢数据。
- `position` 决定顺序，重排时整表重写。

### 5.4 规则热更新

1. 从库中取启用规则，按 `position` 排序。
2. 校验 `type` 在白名单内、`value` 格式合法、`policy` 非空。
3. 渲染 rule-provider 内容（`behavior: classical`）。
4. 内容与磁盘一致则直接返回（幂等）。
5. 写 `custom.yaml.tmp-<pid>` → `rename` 覆盖 → `PUT /providers/rules/custom`。
6. 失败：返回内核原始错误；不重试、不回滚（数据库才是数据源，文件随时可重建）。

### 5.5 系统代理守护（ProxyGuard）

只做一件事：自己设的系统代理不被别人改掉。

接管范围仅 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 下三项：`ProxyEnable`、`ProxyServer`、`ProxyOverride`。不写 `AutoConfigURL`。`ProxyServer` 不给用户填，固定由 `127.0.0.1` + 混合端口拼出来（改混合端口就跟着变）。

| 环节 | 设计 |
| --- | --- |
| 状态 | 只有 `desired`（mihomo-controller-plan 要写入的三项），不做任何备份 |
| 轮询 | 每 60 s 一次，读三项与 desired 比对 |
| 纠正 | 不一致则回写 desired，并调用 `InternetSetOption` 的 `SETTINGS_CHANGED` + `REFRESH` 立即生效 |
| 未接管 | 用户关掉系统代理后立即停止干预 |
| 守护开关 | 不单独提供：开启系统代理即纳入守护，关闭系统代理即停止守护；界面只有这两个动作，用户改不了守护本身 |
| 退出 | 不做还原，注册表保持当前值 |
| 失败 | 回写失败属于环境类异常 → 记录并停止工作 |
| 持久化 | 开关与绕过列表存在 `config.json` 的 `proxy` 段里；代理服务器地址每次启动按混合端口重算 |
| 联动（单向） | 内核就绪（running/adopted）→ 自动开启系统代理并指向内核；内核停止、崩溃或启动失败 → 自动关闭系统代理。反向不成立：界面开关系统代理不启动或停止内核 |

代价：最坏 1 分钟内系统代理处于被改状态；点"开启系统代理"会立即无条件重写一遍（不用等轮询）。

### 5.6 日志

- pino 写 `data/logs/app.log`，按天轮转，保留 7 天。
- 内核 stdout/stderr 写 `data/logs/core.log`，退出时保留最后 200 行。
- 订阅地址与 secret 打码后落盘。

---

## 6. 接口清单

仅监听 `127.0.0.1`，带 `X-Api-Token` 校验。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/status` | 内核状态、版本、端口、订阅状态、系统代理状态 |
| POST | `/api/subscription/refresh` | 立即下载并生效 |
| GET | `/api/subscription/groups` | 订阅文件里的代理组，用于选 `PROXY` 指代哪个组 |
| GET | `/api/rules` | 规则列表 |
| POST | `/api/rules` | 新增（批量，请求体 `{ rules: [...] }`） |
| PUT | `/api/rules/{id}` | 修改 |
| DELETE | `/api/rules/{id}` | 删除 |
| POST | `/api/rules/sync` | 落盘 + 热更新 |
| GET | `/api/ui-config` | 生效值快照：当前值 + 初始化标记（加载时即为 false）+ 文件修改时间 |
| GET | `/api/ui-config/share` | 生成配置分享串（Base64）：界面常量 + 规则 + 内核/代理设置，剔除订阅与 secret |
| POST | `/api/ui-config/import` | 导入配置分享串：界面常量与 rules 段落盘（带 rules 段时整表覆盖并热更新），带 core/proxy 段时一并写回设置；订阅保持本机现状 |
| POST | `/api/ui-config/initialize` | 立即初始化：把 config.json 的 `initialized` 落成 false，内容不动 |
| POST | `/api/ui-config/apply` | 把界面上的界面常量写回 config.json（存过一次就算配置好了） |
| GET | `/api/proxy` | 系统代理期望值 / 实际值 / 是否一致 |
| POST | `/api/proxy/enable` | 开启并纳入守护（每次都会无条件重写一遍注册表三项） |
| POST | `/api/proxy/disable` | 关闭并交还控制权（守护跟着停） |
| GET | `/api/proxies` | 代理组与当前出口（目标策略"代理"的落点） |
| PUT | `/api/proxies/{group}` | 切换该组的出口节点 |
| GET | `/api/proxies/{group}/delay` | 并发测组内各节点时延（毫秒） |
| GET | `/api/logs` | 最近 N 行日志 |
| GET | `/api/failed-connections` | 从内核日志里汇总失败连接（界面用，多选后可加成规则） |
| GET | `/api/ping` | 最轻的问候请求，界面离线时每秒探一次 |
| POST | `/api/offline/shutdown` | 离线兜底：关系统代理 + 停内核 |
| POST | `/api/offline/restart` | 离线兜底：无条件写系统代理期望值 + 重写配置 + 重启内核 |

---

## 7. 配置与生成物

### 7.1 生成的 config.yaml

```yaml
mixed-port: 7890
mode: rule
log-level: info
external-controller: 127.0.0.1:9090
secret: "<随机生成>"

profile:
  store-selected: true   # 用户选的出口跨重启保留

dns:
  # 整体照搬订阅文件的 dns 段（default-nameserver / nameserver-policy / fallback 等）
  # 订阅里没有 dns 段时才用内置最小配置：enable + fake-ip + doh.pub

proxy-providers:
  sub-main:
    type: file
    path: ./subscription.yaml

rule-providers:
  custom:
    type: file
    behavior: classical
    path: ./rules/custom.yaml

proxy-groups:
  - name: PROXY
    type: select
    use: [sub-main]

# proxyGroup 非空时改为复刻所选订阅组，例如选 Proxy：
#   - { name: PROXY, type: select, use: [sub-main], proxies: [failover] }
#   - { name: failover, type: fallback, use: [sub-main], url: ..., interval: 300 }

rules:
  - RULE-SET,custom,PROXY
  - MATCH,DIRECT
```

`rules` 段只保留骨架，业务规则全部进 rule-provider；rule-provider 里每条规则自带目标策略，
命中就按规则走，没命中一律直连（不做 GEOIP 兜底，也不劫持全球流量）。

### 7.2 生成的 rule-provider

```yaml
# 预览模式
payload:
  - DOMAIN-SUFFIX,example.com,PROXY
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
```

---

## 8. 界面

3 页，不做更多。

| 页面 | 内容 |
| --- | --- |
| 规则 | 代理出口（PROXY 指代哪个订阅组 + 出口节点按钮块，可一键测各节点时延）+ 规则表格（增删改、启停、拖拽排序）+ 原始 yaml 文本框 + 保存并热更新 |
| 失败连接 | 内核日志里的失败目标（按协议/主机/端口汇总，只统计最近 10 分钟）多选后批量加成规则 |
| 状态 | 内核状态与版本、端口、订阅信息与刷新订阅、系统代理三项状态、重启内核按钮 |
| 设置 | 内核路径、端口、订阅 URL、系统代理开关、日志查看 |

保存反馈：显示本次 PUT 的 provider 与耗时，失败直接展示内核原始错误。

离线兜底：任何请求返回 5xx 或直接失败 → 界面立刻进离线状态、自动跳到状态页、整页底色转红；离线期间每秒静默 `GET /api/ping`，通了自动解除。离线条上两个显眼按钮走 `electron/preload.cjs` 的 `mcpOffline.action`（进程间调用；浏览器里退回同名 HTTP 接口）："完全关闭代理"= 停内核 + 关系统代理，"立即重启内核"= 无条件写系统代理期望值 + 重写 config.yaml + 重启内核。**系统级副作用只由后端执行**：界面与 Electron 壳都只发起请求，不自己写注册表、不自己杀进程；后端不可用就直说失败。

离线兜底的适用范围：只管"HTTP 通道断了、但进程还活着"——渲染进程请求被拦/超时、Fastify 报错、端口被占、内核卡住。打包运行时后端就在主进程里，进程间直调不经过网络，这类故障下按钮照常生效；开发期后端是独立进程，壳只能退回 HTTP，后端进程真的死了就救不回来（页面本身不受影响：窗口里的界面已经加载在渲染进程里，后端停掉照样渲染，只是请求全失败）。

托盘菜单只有五项：显示窗口、启动/重启内核、开启系统代理、关闭系统代理、安全退出（退出需二次确认，并提示"退出后代理将停止"）。

---

## 9. 工程化

- 单仓库：`src/`（Node）、`ui/`（React）、`electron/`（壳）。
- TypeScript strict；ESLint + Prettier。
- 测试：Vitest 覆盖规则渲染、SQLite 读写、原子写、配置预检；注册表操作抽成接口后可 mock。
- 打包：electron-builder 产出免安装文件夹（exe + resources + data 骨架），压缩成 zip 分发；不做单文件打包、安装包、签名与自动更新。
- 内核二进制：`resources/bin/mihomo.exe` 作为预设版本随包分发（`extraResources` → `resources/bin`），不入库；`npm run dist` 前先跑 `scripts/check-mihomo-binary.mjs`，缺文件直接失败，避免发出没有内核的包。
- 原生能力：渲染层只暴露离线兜底动作与安全退出（`electron/preload.cjs`）；配置写入走"临时文件 → rename 覆盖"，写完即关句柄，不会持续占用配置文件。

---

## 10. 里程碑

| 阶段 | 内容 | 人日 | 验收 |
| --- | --- | --- | --- |
| M0 验证 | 打通 SQLite → provider 文件 → PUT → 生效不断连，确认 `-t` 预检、订阅下载与内核干净退出 | 2 | 手动改规则即时生效，现有下载不断 |
| M1 后端 | 订阅下载、内核托管、配置生成、规则热更新、REST、单实例、ProxyGuard、出错即停 | 6 | 双击 exe 可用；改注册表 60 s 内被纠正；重复双击被拦；异常时明确停止 |
| M2 界面 | Electron 壳 + 3 页 + 规则表 + 热更新反馈 | 4 | 界面改规则 1 s 内生效 |
| M3 打包 | 免安装文件夹、data 目录生成与定位、托盘常驻、关窗口不断网、退出二次确认 | 2 | 解压后双击 exe 填入订阅 URL 即可用；关掉窗口后浏览器仍能上网 |

合计 14 人日。

---

## 11. 测试与验收

| 场景 | 期望 |
| --- | --- |
| 连续高频改规则（10 次/秒，持续 1 分钟） | 数据库无丢失，最终状态一致 |
| 订阅地址返回 404 或非 YAML | 保留旧订阅并报错，不中断现有代理 |
| 订阅域名必须走代理才能访问 | 开启"下载走代理"后可正常下载 |
| 配置写错 | `mihomo -t` 拦下，运行中的代理不受影响 |
| 端口被占用 | 明确报错到端口与 PID，随后停止 |
| 手工改系统代理 | 60 s 内被回写；关闭开关后不再干预 |
| 退出应用 | 注册表保持 mihomo-controller-plan 写入的值（不还原），无残留进程与端口 |
| 关闭窗口 | 窗口消失、托盘图标仍在，代理与系统代理不受影响 |
| 任务管理器结束主进程 | 内核继续运行，浏览器仍能上网；再次双击 exe 能接管且不重复起内核 |
| 把文件夹解压到 `C:\Program Files` 下启动 | 自动回退到 `%LOCALAPPDATA%\mihomo-controller-plan\data` 并给出提示 |
| 把整个 `data/` 复制到另一台机器 | 设置、订阅、规则库都能直接用 |
| 删除 `data/` 后重新启动 | 自动重建目录与默认配置，重新填写订阅 URL 即可 |
| 重复启动 | 第二个实例退出并唤起已有窗口 |

---

## 12. 风险

| 编号 | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | 系统代理被其它程序改写 | 高 | 60 s 守护回写 desired；不做备份还原，只保证写入值正确 |
| R2 | 端口被占用导致启动失败 | 中 | 错误精确到端口与 PID（不做迁移） |
| R3 | 内核异常退出 | 中 | 已知取舍：记录原因后停止工作，由用户手动重启 |
| R4 | 订阅下载失败 | 中 | 保留旧文件；首次启动失败则明确报错停止 |
| R5 | better-sqlite3 原生模块编译 | 低 | 仅 Node 侧使用，Electron 不直接加载 |
| R6 | 60 s 轮询期间代理不可用 | 中 | 已知取舍；点"开启系统代理"立即无条件重写一遍 |
| R7 | 主进程被误杀后无人守护系统代理 | 中 | 内核与注册表值保持不变，网络不中断；再次双击即接管，仅失去 60 s 守护能力 |
| R8 | 应用目录不可写或 `data/` 被误删 | 中 | 启动时按顺序定位可写目录；首次启动自动重建；README 写明备份方式 |

---

## 13. 附录

### A. 本机内核实测

```
Mihomo Meta v1.19.31 windows amd64 with go1.26.8
Use tags: with_gvisor

-d 配置目录   -f 配置文件   -t 仅校验   -v 版本
-ext-ctl HTTP 控制   -ext-ctl-pipe 命名管道   -secret API 密钥
-ext-ui 面板目录   -post-up / -post-down 前后置脚本
```

### B. 内核 API 速查

| 用途 | 端点 |
| --- | --- |
| 探活/版本 | `GET /version` |
| 读写配置 | `GET /configs`、`PUT /configs?force=true` |
| 节点与策略组 | `GET /proxies`、`PUT /proxies/{group}` |
| 订阅 | `GET /providers/proxies`、`PUT /providers/proxies/{name}` |
| 规则集 | `GET /providers/rules`、`PUT /providers/rules/{name}` |
| 规则核对 | `GET /rules` |

### C. 术语

| 术语 | 含义 |
| --- | --- |
| 内核 | 承担实际转发与分流的 mihomo 进程 |
| rule-provider | 规则集来源，mihomo-controller-plan 的规则热更新落点 |
| file provider | 内核直接读取本地文件的 provider 类型 |
| 热更新 | 不重启内核、不断连接地让新规则生效 |
| fail-stop | 出现环境类异常即刻停止，不做自动恢复 |
| 后台常驻 | 主进程在窗口关闭后继续运行，负责内核、规则与系统代理守护 |
