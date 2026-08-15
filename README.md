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

界面分三页，左侧导航切换。

### 总览 Overview

- 8 张概览卡：总用量、预估成本、缓存命中率、会话数、消息数、活跃天数、连续天数、常用模型
- 371 天活跃度热力图
- 成本拆解与缓存收益（含"完全不缓存会花多少"的反事实对比）
- Tokens per day 堆叠柱状图（按模型分色）
- 按项目（工作目录）聚合排行：左侧横向条形 + 右侧明细，两列取同样的前 10 项且共用高度，所以每一行都和自己的柱子齐平
- 模型用量环形图 + 明细：只列**前 5 名**，其余收成一个灰色的 Others。可在 Tokens / 成本 之间切换
- 编程工具（各数据源）分布，同样支持 Tokens / 成本 切换

Top 5 + Others 不只是省地方：24 个模型全列出来，真正重要的那几个会被一长串不到 1% 的行淹没，环形图也会变成一堆读不出来的细丝。

Tokens / 成本 切换也不是装饰——两个口径的排名是不一样的。按 token 算 deepseek-v4-flash 占 35.3% 排第一，按成本算它掉到第 4 只占 6.7%；而 grok-4.5 从 2.1% 的 token 占比变成 22.8% 的花费。只看一个指标会对另一个产生实质误导。

### 趋势 Trends

- **成本 / Token 趋势**：细线为每日值，粗线为 **7 日移动平均**。只画每日线基本没法读——用量是爆发式的还带工作日形状，相邻两天能差一个数量级，真实漂移全被埋掉，移动平均才是回答"我在往上走还是往下走"的那条线。默认看 Tokens，可切成本
- **模型趋势**：前 5 个模型 + 一条 Others，可在 Tokens / 调用次数 之间切换。这两个口径排名同样不同：按 token 是 deepseek-v4-flash 领先，按调用次数则是 glm-5.2——有的模型是"多次便宜调用"，有的是"少次大上下文"

两张图都用平滑曲线，并且开了 `smoothMonotone: 'x'`，防止样条在尖峰和归零日之间过冲到 0 以下（那会暗示负用量）。

### 3D Lab

Token Landscape：最近一年的每日消耗排成等轴测日历地形（x 轴为周、z 轴为星期、一天一根实心柱）。

- 柱高与颜色取自当天用量的**分位等级**（0–4 级，阈值为活跃日的 P50 / P75 / P90），所以地形是五级台地而不是几根孤零零的尖刺。图例上直接写出算出来的分界值，且这些值会随数据浮动
- 371 天每一天都有格子：用量为 0 的画成薄片，连起来就是那块完整一年的长方形底面，柱子从底面上长出来
- 进场时柱子按周序错开生长，波前从左扫到右（约 1.3 秒），读起来是时间轴在展开。尊重系统的 `prefers-reduced-motion`
- 月份轴标签沿前沿投影（1 月改显年份），最新一天套线框笼罩，371 格里一眼能找到"今天"
- 固定看一年、不跟随上方的时间范围（该页也因此隐藏了范围选择器）
- 可拖拽旋转、滚轮缩放、一键复位视角、原生全屏（全屏时左侧统计列自动收起，因为 53:7 的板子那时更需要宽度）
- 左侧给出年度总量、峰值日、活跃率与最长连续天数

侧栏的 Sources 列表可折叠（状态记在 localStorage），并按用量降序。

深色 / 浅色双主题，默认深色。顶栏另有中 / 英语言切换（默认中文，选择记在 localStorage），全部界面文案、周几与月份轴都会跟着切换。

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
  App.tsx              布局、三页导航与状态
  components/          各面板（Overview / Trends / ThreeDLab 三个页面壳 + 各图表）
  lib/format.ts        数字格式化、调色、Top-N + Others
  lib/i18n.tsx         中/英文案字典、LangProvider 与 useI18n()
  styles/              主题变量与组件样式
  shared/types.ts      主进程与渲染进程的契约
```

依赖 Node 内置的 `node:sqlite`（`DatabaseSync`），不需要编译原生模块。

## 已知限制

- **zcode 会裁剪历史**。它的 `model_usage` 表会被定期清理（观察到 7057 行 / 739.8M 变成 6854 行 / 698.7M），所以更早的数据 Token Atlas 也读不到。要保留长期历史需要自己维护一份增量缓存库，目前还没做。
- 仅在 Windows 上验证过。路径解析用的是跨平台写法，但 macOS / Linux 未实测。
- 3D 用的是 three.js 而非 echarts-gl：应用的 CSP 是 `script-src 'self'`，echarts-gl 的 ViewGL 无条件用 `new Function()` 构造 EffectCompositor，会直接抛 `Invalid expression.`。
- 模型用量与模型趋势里的颜色深浅／排名是**相对你自己**的分布算出来的，不能跨账号比较。
- 成本全部是估算，见上一节。

