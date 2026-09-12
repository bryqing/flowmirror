"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Flame,
  Heart,
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
import { YESTERDAY_MIRROR } from "@/lib/mock-data";
import { buildDayMirror } from "@/lib/mirror";
import { effectiveMinutes, windowLabel } from "@/lib/task-time";
import { CATEGORY_META, type TaskStatus } from "@/lib/types";
import { cn, fmtDuration } from "@/lib/utils";

/**
 * 昨日之镜 —— 晨间第一眼。
 *
 * 数据来源分两类，必须分清（详见 lib/mirror.ts 的文件头）：
 *   · 指标（完成率 / 完成数 / 各板块时长 / 黑洞切片 / 踩坑教训）→ **前一天的真实任务**。
 *     以前这里读的是写死的 0.71，用户永远看不到自己真实的完成情况。
 *   · 叙事（记忆碎片 / 认知金句 / 睡前感悟…）→ 目前还没有落库链路，用示例填充，
 *     并在界面上明确标注，绝不与真实指标混在一起冒充统计结果。
 *
 * 「昨日」始终是「今天 - 1 天」，不跟随日期栏的历史回看 —— 否则翻到上月某天时，
 * 这块晨间锚点会跟着变成那一天的镜像，语义就散了。
 */

/** 任务状态 → 徽标文案与配色 */
const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  done: { label: "已完成", className: "border-cat-rest/30 bg-cat-rest/10 text-cat-rest" },
  "in-progress": { label: "进行中", className: "border-cat-deep/30 bg-cat-deep/10 text-cat-deep" },
  pending: { label: "未完成", className: "border-white/12 bg-white/[0.04] text-muted-foreground" },
  frozen: { label: "已冷冻", className: "border-cat-chore/30 bg-cat-chore/10 text-cat-chore" },
};

export function YesterdayMirror() {
  const { yesterdayTasks, yesterdayDate, yesterdayReady } = useFlow();
  const [fragmentsOpen, setFragmentsOpen] = useState(false);
  // 黑洞溯源抽屉：focusIndex 为被点击的具体条目索引，null 表示从整卡进入
  const [blackholeOpen, setBlackholeOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  // 指标实时算自昨日真实任务；无记录时才回退示例叙事
  const { mirror: m, isReal } = useMemo(
    () => buildDayMirror(yesterdayTasks, yesterdayDate, YESTERDAY_MIRROR),
    [yesterdayTasks, yesterdayDate]
  );

  const pct = Math.round(m.completionRate * 100);
  const runaway = m.blackholeSlices.filter((s) => s.runaway);
  const fragmentCount = m.memoryFragments.length + m.insightCards.length;
  const firstFragment = m.memoryFragments[0];

  const openBlackhole = (index: number | null) => {
    setFocusIndex(index);
    setBlackholeOpen(true);
  };

  /** 数据来源标记：统计中 / 实时统计 / 示例数据 */
  const sourceBadge = !yesterdayReady
    ? { text: "统计中…", className: "border-white/12 bg-white/[0.04] text-subtle-foreground" }
    : isReal
      ? { text: "实时统计", className: "border-cat-rest/30 bg-cat-rest/10 text-cat-rest" }
      : { text: "示例数据", className: "border-candle/30 bg-candle/10 text-candle" };

  return (
    <section className="flex flex-col gap-4">
      {/* 区块标题 */}
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold tracking-tight">
          <Sparkles className="size-4 text-cat-chore" />
          昨日之镜
          <span className="font-normal text-zinc-500">Yesterday&apos;s Mirror</span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-[10px] font-normal",
              sourceBadge.className
            )}
            title={
              isReal
                ? "完成率与各板块时长均由昨日真实任务计算"
                : "昨日没有任务记录，以下为示例内容；有记录后自动替换为真实统计"
            }
          >
            {sourceBadge.text}
          </span>
        </h3>
        <p className="text-[11px] text-zinc-400">{m.dateLabel} · 每日第一眼锚点</p>
      </div>

      {/* 无真实记录时把话说清楚，避免把示例的 71% 当成自己的成绩 */}
      {yesterdayReady && !isReal && (
        <div className="glass animate-fade-up flex items-start gap-2.5 rounded-2xl border-candle/20 p-3.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-candle" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {m.dateLabel} 没有任务记录，下方指标与叙事均为<strong className="text-candle">示例</strong>。
            当天有任务（并打钩 / 计时）之后，完成率与各板块时长会立刻换成真实统计。
          </p>
        </div>
      )}

      {/* 两张高对比英雄卡片：加高、舒展文字 */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* 卡片一：昨日时间黑洞（整张可点击 → 失控溯源抽屉） */}
        <button
          type="button"
          onClick={() => openBlackhole(null)}
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
          <p className="mt-1.5 text-[11px] text-zinc-400">休闲娱乐总时长</p>

          <ul className="mt-5 flex flex-1 flex-col gap-2.5 border-t border-cat-blackhole/15 pt-4">
            {m.blackholeSlices.length === 0 && (
              <li className="text-xs text-zinc-500">
                {isReal ? "昨日没有休闲娱乐记录 —— 也是一种自律。" : "暂无黑洞切片。"}
              </li>
            )}
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
                      s.runaway ? "text-cat-blackhole" : "text-zinc-300"
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

        {/* 卡片二：昨日记忆碎片（整张可点击） */}
        <button
          type="button"
          onClick={() => setFragmentsOpen(true)}
          className="hero-gold group animate-fade-up flex min-h-[17rem] flex-col rounded-2xl p-6 text-left sm:p-7"
          style={{ animationDelay: "0.08s" }}
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

          <blockquote className="mt-6 flex gap-2.5">
            <span className="font-serif text-2xl leading-none text-candle/60">“</span>
            <p className="text-base font-normal leading-7 text-zinc-50">
              {firstFragment?.text ?? "昨天还没有沉淀下来的句子 —— 今天做完一件事后，写一句就好。"}
            </p>
          </blockquote>
          {firstFragment && (
            <p className="mt-2 pl-[1.35rem] text-[10px] text-zinc-500">—— {firstFragment.source}</p>
          )}

          {m.mostTouching && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-candle/20 bg-candle/[0.06] p-3.5">
              <Heart className="mt-0.5 size-3.5 shrink-0 text-candle/90" />
              <p className="text-[11px] leading-relaxed text-zinc-300">
                <span className="font-medium text-candle">最触动我的事：</span>
                {m.mostTouching}
              </p>
            </div>
          )}

          <p className="mt-auto pt-4 text-center text-[11px] text-zinc-400 transition-colors group-hover:text-zinc-200">
            点击展开昨日全部 {fragmentCount} 条经验卡片 →
          </p>
        </button>
      </div>

      {/* 昨日完成率与总体评述 —— 数字全部来自前一天的真实任务 */}
      <Card className="animate-fade-up">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <CompletionRing rate={m.completionRate} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
              完成率 {pct}%
              <span className="text-xs font-normal text-zinc-400">
                {m.doneCount}/{m.totalCount} 项 · 紧急重要 {fmtDuration(m.deepWorkMinutes)}
              </span>
              <span
                className={cn(
                  "rounded-full border px-1.5 py-px text-[10px] font-normal",
                  isReal
                    ? "border-cat-rest/30 bg-cat-rest/10 text-cat-rest"
                    : "border-white/12 bg-white/[0.04] text-subtle-foreground"
                )}
              >
                {isReal ? "由昨日任务实时计算" : "示例"}
              </span>
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{m.overallComment}</p>
          </div>
        </CardContent>
      </Card>

      {/* 昨日任务明细：让完成率可逐条核对，而不是一个凭空出现的百分比 */}
      {isReal && (
        <Card className="animate-fade-up" >
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
                  className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-xs transition-colors hover:bg-white/[0.04]"
                >
                  {task.status === "done" ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-cat-rest" />
                  ) : task.status === "frozen" ? (
                    <Ban className="size-3.5 shrink-0 text-cat-chore" />
                  ) : (
                    <span className="size-3.5 shrink-0 rounded-full border border-white/20" />
                  )}
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                    {window ?? "--:--"}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      task.status === "done" ? "text-zinc-500 line-through" : "text-zinc-200"
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
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      CATEGORY_META[task.category].dot
                    )}
                    title={CATEGORY_META[task.category].label}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* 睡前感悟 vs 今晨计划 — 精简对照条 */}
      {(m.bedtimeReflection || m.morningPlan) && (
        <div className="grid animate-fade-up gap-2 sm:grid-cols-2" style={{ animationDelay: "0.12s" }}>
          {m.bedtimeReflection && (
            <div className="glass flex items-start gap-2.5 rounded-xl p-3">
              <Moon className="mt-0.5 size-3.5 shrink-0 text-cat-chore" />
              <p className="text-[11px] leading-relaxed text-zinc-300">
                <span className="font-medium text-zinc-100">睡前感悟：</span>
                {m.bedtimeReflection}
              </p>
            </div>
          )}
          {m.morningPlan && (
            <div className="glass flex items-start gap-2.5 rounded-xl p-3">
              <Sunrise className="mt-0.5 size-3.5 shrink-0 text-cat-deep" />
              <p className="text-[11px] leading-relaxed text-zinc-300">
                <span className="font-medium text-zinc-100">今晨计划：</span>
                {m.morningPlan}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 记忆碎片抽屉：昨日全部经验资产 */}
      <Sheet open={fragmentsOpen} onClose={() => setFragmentsOpen(false)} title="昨日记忆碎片 · 经验资产库">
        <div className="flex flex-col gap-5 px-5 pb-8 pt-1">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            来自微复盘与深夜认知深潜的沉淀，共 {fragmentCount} 条。它们会在未来同类任务中作为「避坑教训」被主动召回。
            <span className="mt-1 block text-subtle-foreground">
              注：叙事内容目前为示例，接入 AI 生成后自动替换；上方完成率等指标已是真实统计。
            </span>
          </p>

          {/* 金句碎片 */}
          <div className="flex flex-col gap-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-candle">
              <Quote className="size-3.5" />
              认知金句
            </p>
            {m.memoryFragments.map((f, i) => (
              <div key={i} className="hero-gold rounded-xl p-3.5">
                <p className="text-sm font-normal leading-relaxed text-zinc-100">“{f.text}”</p>
                <p className="mt-1.5 text-[10px] text-zinc-500">—— {f.source}</p>
              </div>
            ))}
          </div>

          {/* 最触动的事 */}
          {m.mostTouching && (
            <div className="rounded-xl border border-candle/20 bg-candle/[0.06] p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-candle">
                <Heart className="size-3.5" />
                最触动我的事
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{m.mostTouching}</p>
            </div>
          )}

          {/* 经验卡片 */}
          {m.insightCards.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-cat-deep">
                <Lightbulb className="size-3.5" />
                AI 提炼经验卡
              </p>
              {m.insightCards.map((c, i) => (
                <div key={i} className="rounded-xl border border-cat-deep/15 bg-cat-deep/[0.05] p-3.5">
                  <p className="text-xs font-medium text-cat-deep">{c.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">{c.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* 踩坑教训 */}
          {m.lessons.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-cat-blackhole/90">
                <AlertTriangle className="size-3.5" />
                踩坑教训汇总
              </p>
              {m.lessons.map((l, i) => (
                <p key={i} className="flex gap-2 text-[11px] leading-relaxed text-zinc-300">
                  <span className="font-mono text-[10px] text-cat-blackhole/70">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="font-medium text-zinc-100">{l.taskTitle}：</span>
                    {l.text}
                  </span>
                </p>
              ))}
            </div>
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
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
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
