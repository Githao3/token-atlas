# Token Atlas

本地 AI Agent Token 用量图鉴。扫描你电脑上各个 AI 编程 Agent 留下的会话记录，把散落在不同工具里的 token 消耗汇总成一个桌面仪表盘。

数据全程留在本地，不上传任何内容。

## 支持的数据源

| Agent | 位置 | 格式 |
| --- | --- | --- |
| zcode | `~/.zcode/cli/db/db.sqlite` | SQLite（`model_usage` 表），JSONL 回退 |
| opencode | `~/.local/share/opencode/opencode.db` | SQLite（`message` 表，`data` 为 JSON blob） |
| Claude Code | `~/.claude/projects/**/*.jsonl` | JSONL |
| Codex | `~/.codex/sessions/**/*.jsonl` | JSONL |

有 SQLite 账本的优先读 SQLite，比解析 JSONL 更快也更准。数据库以只读方式打开，和正在运行的 Agent 并发共存（WAL 模式）；失败时退回到快照复制。

## 面板内容

- 8 张概览卡：总用量、预估成本、缓存命中率、会话数、消息数、活跃天数、连续天数、常用模型
- Tokens per day 堆叠柱状图（按模型分色）
- 371 天活跃度热力图
- 模型用量环形图 + 明细
- 成本拆解与缓存收益（含"完全不缓存会花多少"的反事实对比）
- 按项目聚合排行
- 数据源分布
- 3D Lab —— Token Landscape：x 轴为日期、z 轴为模型、柱高为 token 量的三维地形，可拖拽旋转、滚轮缩放、悬浮查看单格明细


深色 / 浅色双主题，默认深色。

## 运行

```bash
npm install
npm run dev
```

其他命令：

- `npm run build` — typecheck + 构建
- `npm run start` — 预览构建产物
- `npm run scan:test` — 只跑扫描逻辑并打印统计，不启动界面，调数据问题时很方便
- `npm run dist` — 打 Windows 安装包到 `release/`

Windows 上如果 `npm run dev` 报 `Cannot read properties of undefined (reading 'isPackaged')`，是当前 shell 里有 `ELECTRON_RUN_AS_NODE=1`，清掉再跑：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

## Token 口径

不同厂商对 `input_tokens` 是否已包含缓存命中的 token 说法不一致，直接相加会重复计数。`electron/scan/normalize.ts` 里的 `splitTokens()` 把每条记录拆成四个互不重叠的桶：

- `freshInputTokens` — 真正新发送的输入
- `cacheReadTokens` — 命中缓存的输入
- `cacheWriteTokens` — 写入缓存的输入
- `outputTokens` — 输出

判断依据是各来源自己给出的权威总数（`provider_total_tokens` / `total_tokens`）：能对上 `input + output` 就说明 input 是含缓存的，对上 `input + output + cache` 就说明不含。对不上时按 `input >= cache` 兜底推断，最后把残差并回 `freshInput`，保证四桶之和严格等于权威总数。

Codex 的 JSONL 记的是**累计值** `total_token_usage`，所以取相邻两条的差值；用 `last_token_usage` 会因为每轮重复出现而翻倍。

## 成本估算

价格表在 `~/.token-atlas/pricing.json`，单位是"美元 / 百万 token”，界面上点 Est. cost 卡片可直接打开编辑。规则自上而下按模型名的子串匹配，第一条命中的生效；你写的规则会**插在内置规则前面**，所以只需要覆盖关心的模型，不用重抄整张表。想完全接管就加 `"replaceRules": true`。

成本是估算值：本地记录里没有实际账单，缓存和阶梯定价也各家不同，数字用来看趋势和相对占比，不要当对账依据。

## 架构

```
electron/
  main.ts              主进程、窗口、IPC
  preload.ts           contextBridge 暴露 window.tk
  aggregate.ts         并行调度 4 个 adapter + 汇总
  pricing.ts           价格表加载与计价
  adapters/            每个 Agent 一个采集器
  scan/                normalize / sqlite / util
src/
  App.tsx              布局与状态
  components/          各面板
  styles/              主题变量与组件样式
  shared/types.ts      主进程与渲染进程的契约
```

依赖 Node 内置的 `node:sqlite`（`DatabaseSync`），不需要编译原生模块。

## 已知限制

- **zcode 会裁剪历史**。它的 `model_usage` 表会被定期清理（观察到 7057 行 / 739.8M 变成 6854 行 / 698.7M），所以更早的数据 Token Atlas 也读不到。要保留长期历史需要自己维护一份增量缓存库，目前还没做。
- 仅在 Windows 上验证过。路径解析用的是跨平台写法，但 macOS / Linux 未实测。
- 3D Lab 页面还是占位。

