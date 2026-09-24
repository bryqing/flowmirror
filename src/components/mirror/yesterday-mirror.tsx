"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ChevronRight,
  Flame,
  Heart,
  Inbox,
  Lightbulb,
  ListChecks,
  Moon,
  Quote,
  Search,
  Sparkles,
  Sunrise,
} from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { BlackholeDetailDrawer } from "./blackhole-detail-drawer";
import { buildDayMirror } from "@/lib/mirror";
import { effectiveMinutes, windowLabel } from "@/lib/task-time";
import { CATEGORY_META, type TaskStatus } from "@/lib/types";
import { cn, fmtDuration } from "@/lib/utils";

/**
 * 昨日之镜 —— 晨间第一眼。
 *
 * ## 数据来源：全部来自前一天的真实记录，没有任何预置文案
 *   · 指标（完成率 / 完成数 / 各板块时长 / 黑洞切片）→ 前一天的真实任务；
 *   · 叙事（踩坑教训）→ 任务上的微复盘笔记；
 *   · 认知金句 / 最触动的事 / 经验卡 / 睡前感悟 / 今晨计划 → 等
 *     `mirror_snapshots` 落库后回填，**在那之前一律为空**。
 *
 * 早先版本用一份写死的示例叙事填这些空位（"外界的挑剔，只是内心心虚的放大镜"
 * 等等），结果是没做任何复盘的人也看到一整屏"自己的感悟"，分不清哪些真实。
 * 宁可不显示，也不能让用户把编出来的句子当成自己的沉淀 —— 空态是诚实的信息。
 *
 * ## 排序：有内容的板块置顶
 * 板块顺序不再写死。每个板块先算一个「内容分」（真实录入的条数 / 时长），
 * 有内容的按内容量降序排在前面，没内容的折叠成一行沉到最下方。
 * 这样用户进来第一眼看到的一定是自己真的记过的东西，而不是空壳。
 *
 * 「昨日」始终是「今天 - 1 天」，不跟随日期栏的历史回看 —— 否则翻到上月某天时，
 * 这块晨间锚点会跟着变成那一天的镜像，语义就散了。
 */

/** 任务状态 → 徽标文案与配色 */
const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  done: { label: "已完成", className: "border-cat-rest/30 bg-cat-rest/10 text-cat-rest" },
  "in-progress": { label: "进行中", className: "border-cat-deep/30 bg-cat-deep/10 text-cat-deep" },
  pending: { label: "未完成", className: "border-slate-200 bg-slate-50 text-muted-foreground" },
  frozen: { label: "已冷冻", className: "border-cat-chore/30 bg-cat-chore/10 text-cat-chore" },
};

/** 板块标识（顺序即「内容分相同时」的默认顺序） */
type BlockId = "blackhole" | "fragments" | "completion" | "tasks" | "reflection";

/** 折叠态板块的图标 / 标题 / 空态说明 */
const COLLAPSED_META: Record<
  BlockId,
  { label: string; hint: string; icon: typeof Flame; openable: boolean }
> = {
  blackhole: { label: "昨日时间黑洞", hint: "没有休闲娱乐记录", icon: Flame, openable: true },
  fragments: { label: "昨日记忆碎片", hint: "还没有沉淀下来的句子", icon: Quote, openable: true },
  completion: { label: "完成率与总评", hint: "昨日无记录", icon: CheckCircle2, openable: false },
  tasks: { label: "昨日任务明细", hint: "昨日没有任务", icon: ListChecks, openable: false },
  reflection: { label: "睡前感悟 / 今晨计划", hint: "还没有写过", icon: Moon, openable: false },
};

export function YesterdayMirror() {
  const { yesterdayTasks, yesterdayDate, yesterdayReady } = useFlow();
  const [fragmentsOpen, setFragmentsOpen] = useState(false);
  // 黑洞溯源抽屉：focusIndex 为被点击的具体条目索引，null 表示从整卡进入
  const [blackholeOpen, setBlackholeOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  // 指标实时算自昨日真实任务；无记录时得到全空镜像（不是"示例"）
  const { mirror: m, isReal } = useMemo(
    () => buildDayMirror(yesterdayTasks, yesterdayDate),
    [yesterdayTasks, yesterdayDate]
  );

  const pct = Math.round(m.completionRate * 100);
  const runaway = m.blackholeSlices.filter((s) => s.runaway);
  /** 经验资产总条数（金句 + 经验卡 + 踩坑教训） */
  const assetCount = m.memoryFragments.length + m.insightCards.length + m.lessons.length;

  /**
   * 记忆碎片卡的引言：优先真实金句，退而用第一条踩坑教训。
   * 两者都没有时留 null —— 卡片会被判为「无内容」而折叠置底，不会编一句出来。
   */
  const heroQuote = m.memoryFragments[0]
    ? { text: m.memoryFragments[0].text, source: m.memoryFragments[0].source, kind: "认知金句" }
    : m.lessons[0]
      ? { text: m.lessons[0].text, source: m.lessons[0].taskTitle, kind: "踩坑教训" }
      : null;

  const openBlackhole = (index: number | null) => {
    setFocusIndex(index);
    setBlackholeOpen(true);
  };

  /**
   * 各板块「内容分」。刻意用**条数**而不是布尔值：
   * 「昨天记了 5 条教训」应该排在「只写了 1 条睡前感悟」前面。
   */
  const weights = useMemo<Record<BlockId, number>>(
    () => ({
      blackhole:
        m.blackholeSlices.length * 10 +
        (m.blackholeMinutes > 0 ? 4 : 0) +
        (m.blackholeComment ? 1 : 0),
      fragments:
        m.memoryFragments.length * 10 +
        m.insightCards.length * 10 +
        m.lessons.length * 10 +
        (m.mostTouching ? 5 : 0),
      completion: isReal ? 8 : 0,
      tasks: isReal ? yesterdayTasks.length * 10 : 0,
      reflection: (m.bedtimeReflection ? 4 : 0) + (m.morningPlan ? 4 : 0),
    }),
    [m, isReal, yesterdayTasks.length]
  );

  /**
   * 排序单元：两个 hero 卡（黑洞 / 记忆碎片）若**同时**有内容，
   * 合成一个单元整体参与排序 —— 这样它们永远并排成一行，
   * 不会出现「一个半宽 hero 后面跟一个全宽卡片」把网格撑出空洞的情况。
   */
  const layout = useMemo(() => {
    const hasBlackhole = weights.blackhole > 0;
    const hasFragments = weights.fragments > 0;
    const units: { key: string; weight: number; order: number }[] = [];

    if (hasBlackhole && hasFragments) {
      units.push({
        key: "heroes",
        weight: Math.max(weights.blackhole, weights.fragments),
        order: 0,
      });
    } else {
      if (hasBlackhole) units.push({ key: "blackhole", weight: weights.blackhole, order: 0 });
      if (hasFragments) units.push({ key: "fragments", weight: weights.fragments, order: 0 });
    }
    (["completion", "tasks", "reflection"] as BlockId[]).forEach((id) => {
      if (weights[id] > 0) units.push({ key: id, weight: weights[id], order: 0 });
    });

    const originalRank: Record<string, number> = {
      heroes: 0,
      blackhole: 0,
      fragments: 1,
      completion: 2,
      tasks: 3,
      reflection: 4,
    };
    const content = [...units].sort(
      (a, b) => b.weight - a.weight || originalRank[a.key] - originalRank[b.key]
    );

    // 空板块：保持原有的固定顺序沉在最后
    const empty = (
      ["blackhole", "fragments", "completion", "tasks", "reflection"] as BlockId[]
    ).filter((id) => weights[id] === 0);

    return { content, empty };
  }, [weights]);

  /** 数据来源标记：统计中 / 实时统计 / 暂无记录 */
  const sourceBadge = !yesterdayReady
    ? { text: "统计中…", className: "border-slate-200 bg-slate-50 text-subtle-foreground" }
    : isReal
      ? { text: "实时统计", className: "border-cat-rest/30 bg-cat-rest/10 text-cat-rest" }
      : { text: "暂无记录", className: "border-slate-200 bg-slate-50 text-subtle-foreground" };

  // ============================ 各板块渲染 ============================

  /** 黑洞卡（hero-rose）：整张可点击 → 失控溯源抽屉 */
  const blackholeBlock = (
    <button
      type="button"
      onClick={() => openBlackhole(null)}
      data-mirror-block="blackhole"
      className="hero-rose group animate-fade-up flex min-h-[17rem] cursor-pointer flex-col rounded-2xl p-6 text-left sm:p-7"
      aria-label="打开昨日时间黑洞失控溯源详情"
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-cat-blackhole/30 bg-cat-blackhole/10">
            <Flame className="size-4.5 text-cat-blackhole" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">昨日时间黑洞</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-cat-blackhole/60">
              Time Black Hole
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-cat-blackhole/30 bg-cat-blackhole/10 px-2.5 py-1 text-[10px] text-cat-blackhole">
            失控 {runaway.length} 段
          </span>
          <Search className="size-4 text-cat-blackhole/50 transition-transform duration-300 group-hover:scale-110" />
        </div>
      </div>

      <p className="mt-6 font-mono text-[2.1rem] font-light leading-none tabular-nums tracking-tight text-cat-blackhole">
        {fmtDuration(m.blackholeMinutes)}
      </p>
      <p className="mt-1.5 text-[11px] text-slate-500">休闲娱乐总时长</p>

      <ul className="mt-5 flex flex-1 flex-col gap-2.5 border-t border-cat-blackhole/15 pt-4">
        {m.blackholeSlices.map((s, i) => (
          <li key={i}>
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                openBlackhole(i);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  openBlackhole(i);
                }
              }}
              className={cn(
                "-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-baseline gap-2.5 rounded-lg px-2 py-1 text-left text-xs leading-relaxed transition-colors",
                "hover:bg-cat-blackhole/[0.12]"
              )}
              aria-label={`查看「${s.label}」失控溯源`}
            >
              <span className="shrink-0 font-mono text-[10px] text-cat-blackhole/80">
                {s.start}–{s.end}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  s.runaway ? "text-cat-blackhole" : "text-slate-700"
                )}
              >
                {s.label}
                {s.runaway && (
                  <span className="ml-1.5 rounded bg-cat-blackhole/15 px-1.5 py-px text-[10px]">
                    失控段
                  </span>
                )}
              </span>
              <ArrowUpRight className="size-3 shrink-0 text-cat-blackhole/40 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </li>
        ))}
      </ul>

      {m.blackholeComment && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-cat-blackhole/20 bg-cat-blackhole/[0.07] p-3.5 text-[11px] leading-relaxed text-cat-blackhole/90">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {m.blackholeComment}
        </p>
      )}

      <p className="mt-3 text-center text-[11px] text-cat-blackhole/60 transition-colors group-hover:text-cat-blackhole">
        点击查看失控溯源 · AI 生成今日保护方案 →
      </p>
    </button>
  );

  /** 记忆碎片卡（hero-gold）：整张可点击 → 经验资产库 */
  const fragmentsBlock = (
    <button
      type="button"
      onClick={() => setFragmentsOpen(true)}
      data-mirror-block="fragments"
      className="hero-gold group animate-fade-up flex min-h-[17rem] flex-col rounded-2xl p-6 text-left sm:p-7"
      aria-label="打开昨日记忆碎片与经验卡片库"
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-candle/30 bg-candle/10">
            <Quote className="size-4.5 text-candle" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">昨日记忆碎片</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-candle/60">
              Memory Fragments
            </p>
          </div>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-subtle-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>

      {heroQuote && (
        <>
          <blockquote className="mt-6 flex gap-2.5">
            <span className="font-serif text-2xl leading-none text-candle/60">“</span>
            <p className="text-base font-normal leading-7 text-slate-900">{heroQuote.text}</p>
          </blockquote>
          <p className="mt-2 pl-[1.35rem] text-[10px] text-slate-400">
            —— {heroQuote.source}
            <span className="ml-2 rounded border border-candle/25 px-1 py-px text-[9px] text-candle/80">
              {heroQuote.kind}
            </span>
          </p>
        </>
      )}

      {m.mostTouching && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-candle/20 bg-candle/[0.06] p-3.5">
          <Heart className="mt-0.5 size-3.5 shrink-0 text-candle/90" />
          <p className="text-[11px] leading-relaxed text-slate-700">
            <span className="font-medium text-candle">最触动我的事：</span>
            {m.mostTouching}
          </p>
        </div>
      )}

      <p className="mt-auto pt-4 text-center text-[11px] text-slate-500 transition-colors group-hover:text-slate-800">
        点击展开昨日全部 {assetCount} 条经验资产 →
      </p>
    </button>
  );

  /** 完成率与总体评述 —— 数字全部来自前一天的真实任务 */
  const completionBlock = (
    <Card className="animate-fade-up" data-mirror-block="completion">
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <CompletionRing rate={m.completionRate} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            完成率 {pct}%
            <span className="text-xs font-normal text-slate-500">
              {m.doneCount}/{m.totalCount} 项 · 紧急重要 {fmtDuration(m.deepWorkMinutes)}
            </span>
            <span className="rounded-full border border-cat-rest/30 bg-cat-rest/10 px-1.5 py-px text-[10px] font-normal text-cat-rest">
              由昨日任务实时计算
            </span>
          </p>
          {m.overallComment && (
            <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{m.overallComment}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  /** 昨日任务明细：让完成率可逐条核对，而不是一个凭空出现的百分比 */
  const tasksBlock = (
    <Card className="animate-fade-up" data-mirror-block="tasks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xs font-medium">
          <ListChecks className="size-3.5 text-cat-chore" />
          昨日任务明细
          <span className="font-mono text-[10px] font-normal text-subtle-foreground">
            {m.doneCount}/{m.totalCount} 完成
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 pt-0">
        {yesterdayTasks.map((task) => {
          const status = STATUS_META[task.status];
          const window = windowLabel(task);
          const minutes = effectiveMinutes(task);
          return (
            <div
              key={task.id}
              data-yesterday-task={task.id}
              data-yesterday-status={task.status}
              className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-xs transition-colors hover:bg-slate-100"
            >
              {task.status === "done" ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-cat-rest" />
              ) : task.status === "frozen" ? (
                <Ban className="size-3.5 shrink-0 text-cat-chore" />
              ) : (
                <span className="size-3.5 shrink-0 rounded-full border border-slate-300" />
              )}
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">
                {window ?? "--:--"}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  task.status === "done" ? "text-slate-400 line-through" : "text-slate-800"
                )}
              >
                {task.title}
              </span>
              {minutes > 0 && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-subtle-foreground">
                  {fmtDuration(minutes)}
                </span>
              )}
              <span className={cn("shrink-0 rounded border px-1 py-px text-[9px]", status.className)}>
                {status.label}
              </span>
              <span
                className={cn("size-1.5 shrink-0 rounded-full", CATEGORY_META[task.category].dot)}
                title={CATEGORY_META[task.category].label}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  /** 睡前感悟 vs 今晨计划 — 精简对照条 */
  const reflectionBlock = (
    <div className="grid animate-fade-up gap-2 sm:grid-cols-2" data-mirror-block="reflection">
      {m.bedtimeReflection && (
        <div className="glass flex items-start gap-2.5 rounded-xl p-3">
          <Moon className="mt-0.5 size-3.5 shrink-0 text-cat-chore" />
          <p className="text-[11px] leading-relaxed text-slate-700">
            <span className="font-medium text-slate-900">睡前感悟：</span>
            {m.bedtimeReflection}
          </p>
        </div>
      )}
      {m.morningPlan && (
        <div className="glass flex items-start gap-2.5 rounded-xl p-3">
          <Sunrise className="mt-0.5 size-3.5 shrink-0 text-cat-deep" />
          <p className="text-[11px] leading-relaxed text-slate-700">
            <span className="font-medium text-slate-900">今晨计划：</span>
            {m.morningPlan}
          </p>
        </div>
      )}
    </div>
  );

  const renderBlock = (key: string) => {
    switch (key) {
      case "blackhole":
        return blackholeBlock;
      case "fragments":
        return fragmentsBlock;
      case "completion":
        return completionBlock;
      case "tasks":
        return tasksBlock;
      case "reflection":
        return reflectionBlock;
      default:
        return null;
    }
  };

  return (
    <section className="flex flex-col gap-4">
      {/* 区块标题 */}
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold tracking-tight">
          <Sparkles className="size-4 text-cat-chore" />
          昨日之镜
          <span className="font-normal text-slate-400">Yesterday&apos;s Mirror</span>
          <span
            data-mirror-badge
            className={cn(
              "rounded-full border px-1.5 py-px text-[10px] font-normal",
              sourceBadge.className
            )}
            title={
              isReal
                ? "完成率与各板块时长均由昨日真实任务计算"
                : "昨日没有任何记录，因此不展示任何内容"
            }
          >
            {sourceBadge.text}
          </span>
        </h3>
        <p className="text-[11px] text-slate-500">{m.dateLabel} · 每日第一眼锚点</p>
      </div>

      {yesterdayReady && layout.content.length === 0 ? (
        /* 纯净空态：没有记录就不摆任何卡片、不显示任何数字与句子 */
        <Card className="animate-fade-up" data-mirror-empty>
          <CardContent className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
              <Inbox className="size-5 text-slate-300" />
            </span>
            <p className="text-sm font-medium text-slate-700">{m.dateLabel}暂无记录</p>
            <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
              完成任意任务并打钩或计时后，这里会变成你的镜像：完成率、失控时段、
              微复盘里写下的踩坑教训都会逐条出现。
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 置顶区：按内容分降序，有真实录入的板块排在前面 */}
          <div className="flex flex-col gap-4" data-mirror-content-zone>
            {layout.content.map((unit) =>
              unit.key === "heroes" ? (
                /* 两张 hero 卡同时有内容才并排；单独出现时占满整行，不留空洞 */
                <div
                  key="heroes"
                  data-mirror-unit="heroes"
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                >
                  {blackholeBlock}
                  {fragmentsBlock}
                </div>
              ) : (
                <div key={unit.key} data-mirror-unit={unit.key} className="contents">
                  {renderBlock(unit.key)}
                </div>
              )
            )}
          </div>

          {/* 后置区：没有录入内容的板块折叠成一行，点击仍可进入原抽屉 */}
          {layout.empty.length > 0 && (
            <div className="flex flex-col gap-1.5" data-mirror-collapsed-zone>
              <p className="px-1 text-[11px] text-subtle-foreground">
                以下板块昨日没有记录，已折叠置底
              </p>
              {layout.empty.map((id) => {
                const meta = COLLAPSED_META[id];
                const Icon = meta.icon;
                const inner = (
                  <>
                    <Icon className="size-3.5 shrink-0 text-slate-300" />
                    <span className="shrink-0 text-xs text-slate-600">{meta.label}</span>
                    <span className="min-w-0 flex-1 truncate text-left text-[11px] text-subtle-foreground">
                      {meta.hint}
                    </span>
                    {meta.openable && (
                      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-slate-400">
                        查看
                        <ChevronRight className="size-3" />
                      </span>
                    )}
                  </>
                );
                return meta.openable ? (
                  <button
                    key={id}
                    type="button"
                    data-mirror-collapsed={id}
                    onClick={() => (id === "blackhole" ? openBlackhole(null) : setFragmentsOpen(true))}
                    className="glass flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    {inner}
                  </button>
                ) : (
                  <div
                    key={id}
                    data-mirror-collapsed={id}
                    className="glass flex items-center gap-2.5 rounded-xl px-3.5 py-2.5"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 记忆碎片抽屉：昨日全部经验资产（只渲染真有内容的区块） */}
      <Sheet
        open={fragmentsOpen}
        onClose={() => setFragmentsOpen(false)}
        title="昨日记忆碎片 · 经验资产库"
      >
        <div className="flex flex-col gap-5 px-5 pb-8 pt-1">
          {assetCount === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
              <Inbox className="size-5 text-slate-300" />
              <p data-asset-empty className="text-sm font-medium text-slate-700">
                昨日暂无沉淀记录
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                在任务详情里写一条微复盘（卡点或收获），或完成一次深夜认知深潜，
                这里就会出现你自己写下的避坑教训与认知金句。
              </p>
            </div>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-slate-500">
                共 {assetCount} 条，全部来自你昨日写下的微复盘与深潜记录。
                它们会在未来同类任务中作为「避坑教训」被主动召回。
              </p>

              {/* 区块按内容量降序：写得多的排前面，没写的根本不渲染 */}
              {[
                {
                  id: "lessons",
                  count: m.lessons.length,
                  node: (
                    <div className="flex flex-col gap-2" data-asset-block="lessons">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-cat-blackhole/90">
                        <AlertTriangle className="size-3.5" />
                        踩坑教训汇总
                      </p>
                      {m.lessons.map((l, i) => (
                        <p key={i} className="flex gap-2 text-[11px] leading-relaxed text-slate-700">
                          <span className="font-mono text-[10px] text-cat-blackhole/70">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>
                            <span className="font-medium text-slate-900">{l.taskTitle}：</span>
                            {l.text}
                          </span>
                        </p>
                      ))}
                    </div>
                  ),
                },
                {
                  id: "quotes",
                  count: m.memoryFragments.length,
                  node: (
                    <div className="flex flex-col gap-2.5" data-asset-block="quotes">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-candle">
                        <Quote className="size-3.5" />
                        认知金句
                      </p>
                      {m.memoryFragments.map((f, i) => (
                        <div key={i} className="hero-gold rounded-xl p-3.5">
                          <p className="text-sm font-normal leading-relaxed text-slate-900">
                            “{f.text}”
                          </p>
                          <p className="mt-1.5 text-[10px] text-slate-400">—— {f.source}</p>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  id: "insights",
                  count: m.insightCards.length,
                  node: (
                    <div className="flex flex-col gap-2.5" data-asset-block="insights">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-cat-deep">
                        <Lightbulb className="size-3.5" />
                        AI 提炼经验卡
                      </p>
                      {m.insightCards.map((c, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-cat-deep/15 bg-cat-deep/[0.05] p-3.5"
                        >
                          <p className="text-xs font-medium text-cat-deep">{c.title}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-700">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  id: "touching",
                  count: m.mostTouching ? 1 : 0,
                  node: (
                    <div
                      className="rounded-xl border border-candle/20 bg-candle/[0.06] p-3.5"
                      data-asset-block="touching"
                    >
                      <p className="flex items-center gap-1.5 text-xs font-medium text-candle">
                        <Heart className="size-3.5" />
                        最触动我的事
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-700">
                        {m.mostTouching}
                      </p>
                    </div>
                  ),
                },
              ]
                .filter((b) => b.count > 0)
                .sort((a, b) => b.count - a.count)
                .map((b) => (
                  <div key={b.id}>{b.node}</div>
                ))}
            </>
          )}
        </div>
      </Sheet>

      {/* 黑洞溯源抽屉：失控时段明细 + AI 保护方案 */}
      <BlackholeDetailDrawer
        open={blackholeOpen}
        mirror={m}
        focusIndex={focusIndex}
        onClose={() => setBlackholeOpen(false)}
      />
    </section>
  );
}

function CompletionRing({ rate }: { rate: number }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex size-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(15,23,42,0.1)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="var(--color-cat-rest)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - rate)}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <span className="absolute font-mono text-sm font-light tabular-nums">{Math.round(rate * 100)}%</span>
    </span>
  );
}
