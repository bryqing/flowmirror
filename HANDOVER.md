# FlowMirror · 掌控时间黑洞 — 工程交接文档

> 更新日期：2026-09-08
> 当前阶段：**前端视觉与交互原型已定型（Mock 数据驱动）**，生产构建通过，本地运行于 `http://localhost:3100`。

***

## 1. 项目概述

FlowMirror（掌控时间黑洞）是一套自适应 PC 端与安卓手机端（PWA）的**个人效能与心智成长系统**。核心产品闭环：

- **自然语言调度**：一句话安排任务（"明天上午10点整理报表"、"刷半小时视频"），规则引擎解析为结构化任务。

- **今日战局**：2x2 四象限（深度工作 / 日常杂务 / 娱乐黑洞 / 休息恢复）管理当日任务，点击任务弹出微复盘/详情抽屉。

- **昨日之镜**：每日第一眼锚点，展示昨日时间黑洞、记忆碎片、完成率与总体评述。

- **24 小时时间黑洞热力大盘**：彩色切片条 + 分时段明细。

- **深夜认知深潜**（待建）：夜间情绪对话与经验沉淀。

***

## 2. 技术架构

| 维度       | 选型                                                                   | 备注                                                                    |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 框架       | **Next.js 16.3.4（App Router，Turbopack）**                             | React 19.2.8，TypeScript 5                                             |
| 样式       | **Tailwind CSS v4**（`@tailwindcss/postcss`）                          | 主题令牌定义在 `globals.css` 的 `@theme` 中，无 `tailwind.config`                |
| 组件范式     | **Shadcn UI 风格**（手写本地组件，非 CLI 安装）                                    | `src/components/ui/`：card / button / input / textarea / badge / sheet |
| 图标       | **lucide-react**                                                     | <br />                                                                |
| 类名工具     | `clsx` + `tailwind-merge`（`cn()` 于 `src/lib/utils.ts`）               | <br />                                                                |
| 状态管理     | **React Context**（`src/components/flow-context.tsx`）                 | 任务增删改、完成、熔断关怀模式，当前仅内存态                                                |
| 后端 / 数据库 | **暂无**（Mock 数据）                                                      | 下一步接 Supabase                                                         |
| PWA      | `src/app/manifest.ts`（MetadataRoute.Manifest）+ `viewport.themeColor` | 基础清单已就位，离线能力待补（见第 6 节）                                                |

### 目录结构

```
src/
├── app/
│   ├── layout.tsx          # 根布局：AppShell 包裹、themeColor #0b0e14
│   ├── page.tsx            # 首页三层结构编排
│   ├── manifest.ts         # PWA 清单（background/theme = #0b0e14）
│   └── globals.css         # 设计令牌 + 玻璃质感 + 光晕 + 动画
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx   # 顶层容器：atmosphere 光晕层 + 内容区
│   │   ├── command-bar.tsx # 自然语言输入条（今日战局顶部静态通栏）
│   │   └── date-strip.tsx  # 横向日期胶囊条
│   ├── mirror/
│   │   └── yesterday-mirror.tsx  # 【顶层】昨日之镜：双英雄卡 + 完成率 + 抽屉
│   ├── today/
│   │   ├── today-flow.tsx        # 【中层】今日战局区块编排
│   │   ├── task-quadrants.tsx    # 2x2 四象限网格 + SVG 圆环进度
│   │   ├── morning-anchor.tsx    # 晨间金句锚点卡片
│   │   └── task-detail-drawer.tsx# 任务详情/微复盘抽屉（Sheet）
│   ├── heatmap/
│   │   └── time-heatmap.tsx      # 【底层】24h 时间分布热力大盘
│   ├── review/review-drawer.tsx  # 微复盘抽屉
│   ├── flow-context.tsx          # 全局状态 Provider
│   └── ui/                       # shadcn 风格基础组件
└── lib/
    ├── types.ts            # 任务/复盘/热力图数据模型
    ├── mock-data.ts        # 全量 Mock 数据（任务、昨日之镜、热力切片）
    ├── nlp.ts              # 规则版自然语言解析（时间/时长/分类）
    ├── sound.ts            # 完成提示音（Web Audio）
    └── utils.ts            # cn()、fmtDuration() 等
```

***

## 3. 视觉与布局规范（已定型，勿轻易改动）

### 3.1 色彩令牌（`globals.css @theme`）

- **全局底色**：深空蓝黑 `#0b0e14`（`--color-background`；设计谱系上由 `#09090b → #0A0C10 → #0b0e14` 演进，**以代码现状** **`#0b0e14`** **为准**，非纯黑）。

- 表面层级：`--color-surface: #10141d`、`--color-elevated: #181d2a`。

- 文字层级：`foreground #f4f5f8` / `muted #9aa0b0` / `subtle #626a7d`；**组件内实际约定**：主标题 `text-zinc-100`、正文 `text-zinc-300`、辅助标签 `text-zinc-400`、弱化/来源 `text-zinc-500`。

- 四象限分类色：深度工作（青 `cat-deep`）、日常杂务（紫 `cat-chore`）、娱乐黑洞（红 `cat-blackhole`）、休息恢复（绿 `cat-rest`）、暖烛光金（`candle`，用于记忆碎片）。

### 3.2 环境光晕（Atmosphere Glow）

- `.atmosphere::before` 为 **`position: fixed`** **固定氛围层**（滚动常驻）：

  - 顶部主光源：`radial-gradient(1000px at 50% -20%, rgba(56,189,248,0.08), rgba(99,102,241,0.05) 40%, transparent 80%)`

  - 底部冷反光：`radial-gradient(900px at 50% 118%, rgba(30,41,82,0.18), transparent 70%)`

### 3.3 毛玻璃材质

- **标准卡片** **`.glass`**：`background: rgba(19,23,34,0.6)`（即 `#131722/60`）+ `backdrop-filter: blur(24px) saturate(1.4)` + `border: 1px solid rgba(255,255,255,0.08)` + 柔影；hover 提亮至 `rgba(22,27,40,0.8)` / 边框 `white/16`。

- **强磨砂** **`.glass-strong`**（命令条、抽屉等浮层）：`rgba(19,23,34,0.92)` + `blur(28px)`。

- 英雄卡 `.hero-rose` / `.hero-gold`：昨日之镜双卡，带微弱红/金冷光边框。

### 3.4 页面三层结构（`page.tsx`，自上而下严格顺序）

1. **顶层 · 昨日之镜 Yesterday's Mirror**

   - 并排双英雄卡：【昨日时间黑洞】（红色系，失控时段列表 + 警示评述）｜【昨日记忆碎片】（金色系，金句引言 + 最触动的事，整卡可点开启经验库抽屉）

   - 下方：完成率圆环卡 + 总体评述；睡前感悟 / 今晨计划对照条
2. **中层 · 今日战局 Today's Flow（主战场）**，区块内顺序：

   1. 区块标题栏（完成/待处理计数）
   2. **自然语言输入条**：静态通栏一行（`glass-strong` + 冰青微光边框，聚焦辉光增强）——**严禁 sticky 悬浮、严禁插入 2x2 网格**
   3. 横向日期胶囊条
   4. 晨间金句锚点卡片
   5. 熔断关怀横幅（条件渲染）
   6. **2x2 四象限网格**：卡片 `min-h-[175px] p-5`；头部 `min-h-[36px] items-center`（右上 SVG 圆环与标题水平对齐）；任务条 `-mx-2 px-2 rounded-lg hover:bg-white/[0.04] transition-colors`，条目间距 `gap-2.5`
3. **底层 · 今日时间分布 24 小时黑洞热力大盘**

   - 24 格彩色切片条（透明度约 70%，不喧宾夺主）+ 各板块耗时与分时段明细小字

### 3.5 其他规范

- 响应式：移动端单列堆叠，`sm:` 断点起双列/四象限 2x2；`viewport maximumScale=1, viewportFit=cover`。

- 动效：`animate-fade-up` 错峰入场（`animationDelay` 按卡片序递增）、`animate-pulse-dot` 进行中指示。

- 快捷键：`Ctrl/⌘ + K` 聚焦命令条。

***

## 4. 当前数据流状态

- **全部数据为 Mock**：`src/lib/mock-data.ts` 提供今日任务（四分类）、昨日之镜（黑洞切片、记忆碎片、经验卡、踩坑教训、完成率）、24h 热力切片。

- **运行时状态**：`flow-context.tsx` 在内存中持有任务列表，支持：自然语言新增任务（`nlp.ts` 规则解析中文时间词/时长词如"半小时"=30 分钟/分类推断）、勾选完成（触发 `sound.ts` 提示音）、打开任务详情抽屉、熔断关怀模式开关。**刷新即丢失，无持久化**。

- **微复盘/详情抽屉已就位**：`task-detail-drawer.tsx`（任务维度）与 `review-drawer.tsx`（复盘维度）均基于 `ui/sheet.tsx` 右侧抽屉；昨日记忆碎片抽屉内含金句、经验卡、踩坑教训列表。

- **已知解析边界**：`nlp.ts` 为正则规则版，复杂时间表达（重复、跨天、相对日期歧义）覆盖有限，设计上预留了替换为 LLM 的接口形态。

***

## 5. 本地开发

```bash
npm install        # 依赖已安装
npm run dev        # 开发模式（Turbopack）
npm run build      # 生产构建（当前通过）
npx next start -p 3100   # 生产预览（3000 端口曾被占用，统一用 3100）
npm run lint
```

环境注意（Windows）：PowerShell 执行策略受限，使用 `npm.cmd` / `npx.cmd`；冒烟测试可直接 `Invoke-WebRequest http://localhost:3100` 后正则核验 DOM 类名与编译后 CSS（`/_next/static/chunks/*.css`，Tailwind v4 输出为 oklch/hex-alpha，勿按 rgba 字面量匹配）。

***

## 6. 下一步开发核心目标（按优先级）

### 6.1 PWA 完善（移动端可安装）

现状：`manifest.ts` 已输出名称、`display: standalone`、`background_color/theme_color: #0b0e14`、图标位（`/icon.svg`、`/icon-maskable.svg` 为占位）。

待办：

- 补齐真实应用图标（PNG 192/512 + maskable，建议 public/ 下生成）。

- 引入 **Service Worker**（推荐 `next-pwa` 或手写 SW + Workbox）：离线壳缓存、静态资源预缓存、数据请求后台同步（Queue Sync）。

- 安卓安装体验校验：`apple-mobile-web-app-capable` 等 iOS meta、启动画面、安全区（`viewport-fit=cover` + `env(safe-area-inset-*)`）。

- 真机/桌面双端断点走查（四象限在窄屏降级为单列的体验已具备，需手势与抽屉拖拽复核）。

### 6.2 Supabase 云端数据库（替代 Mock，多端同步）

- 建表建议（贴合 `lib/types.ts`）：`tasks`（id、user\_id、title、category 四象限、scheduled\_time、duration\_min、status、date、created\_at）、`reviews`（微复盘问答、情绪标签）、`mirror_snapshots`（每日黑洞/完成率/金句快照）、`memory_fragments`（金句/经验卡/踩坑教训，可被同类任务召回）、`heatmap_slices`（24h 切片）。

- 认证：Supabase Auth（邮箱 OTP / 魔法链接，移动端优先），RLS 策略按 `user_id` 隔离。

- 客户端：`@supabase/supabase-js`，将 `flow-context.tsx` 的内存 reducer 改为远程读写 + 本地缓存（`localStorage`/`IndexedDB` 离线优先，上线后与 SW 后台同步配合）。

- 数据迁移：把 `mock-data.ts` 改造为 seed 脚本（Supabase seed / 一键灌入演示账号）。

- 实时多端同步：任务勾选/新增走 Supabase Realtime 订阅。

### 6.3 AI 对话接口（三大智能场景）

- **战术锦囊**：命令条解析增强——`nlp.ts` 规则解析保留为离线兜底，在线时调用 LLM 输出结构化 JSON（任务标题/分类/时间/时长/提醒），支持模糊与复杂表达。

- **微复盘追问**：任务完成/失控后，抽屉内 AI 多轮追问（为什么刷超时？触发情绪？），产出沉淀写入 `memory_fragments` 与 `reviews`。

- **深夜认知深潜 Deep Night Dive**：夜间模式（22:30 后或手动进入）全屏沉浸式对话，情绪陪伴 + 当日复盘总结 + 次日建议，生成"晨间金句"反哺 `morning-anchor`。

- 工程建议：Next.js **Route Handlers** 做服务端代理（密钥不下发）、流式输出（SSE）、提示词版本化；对话记录入库 Supabase；规则解析与 AI 解析共用同一任务 schema，保证可降级。

### 6.4 其他建议（次要）

- 画中画悬浮计时器（黑洞任务进行中常驻）。

- localStorage/IndexedDB 先做一版本地持久化（在 Supabase 之前即可消除刷新丢数据）。

- E2E 冒烟测试脚本化（当前为手动 PowerShell 正则核验）。

***

## 7. 交接联系点

- 设计规范源头：本文件第 3 节 + `src/app/globals.css` 注释；视觉调整请先改令牌/工具类，勿在组件内硬编码散色。

- 数据模型唯一事实源：`src/lib/types.ts`；Mock 结构即未来 Supabase 表结构蓝本。

- 页面编排唯一事实源：`src/app/page.tsx`（三层顺序）与 `src/components/today/today-flow.tsx`（中层内部顺序），调整模块顺序务必同步本文件。

