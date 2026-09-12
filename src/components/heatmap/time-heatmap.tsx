"use client";

import { Activity, AlarmClock, Clock3 } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_META, type TaskCategory } from "@/lib/types";
import {
  blackholeWarning,
  CATEGORY_ORDER,
  deriveHeatmap,
  hasTimeData,
  windowLabel,
} from "@/lib/task-time";
import { cn, fmtDuration } from "@/lib/utils";

/**
 * 今日时间分布 · 24 小时热力大盘。
 *
 * 数据完全由**当前视图的任务**派生（见 lib/task-time.ts 的 deriveHeatmap）：
 * 任务卡片上标的「时间段」与「计时记录」自动变成这里的色带与切片，
 * 不再有任何写死的 mock 曲线 —— 之前那份 24 格是画上去的，和任务毫无关系。
 *
 * 口径：同一小时里按占用分钟数最多的板块取主色，强度按覆盖率分档。
 * 没有任何时间信息的任务不会产生格子（不猜、不补默认值）。
 */

const CELL_COLOR: Record<TaskCategory, [string, string, string]> = {
  // intensity 1 / 2 / 3
  "deep-work": ["bg-cat-deep/20", "bg-cat-deep/45", "bg-cat-deep/75"],
  chore: ["bg-cat-chore/20", "bg-cat-chore/45", "bg-cat-chore/70"],
  blackhole: ["bg-cat-blackhole/25", "bg-cat-blackhole/55", "bg-cat-blackhole/85"],
  rest: ["bg-cat-rest/20", "bg-cat-rest/45", "bg-cat-rest/70"],
};

export function TimeHeatmap() {
  const { tasks, isViewingToday } = useFlow();

  const data = deriveHeatmap(tasks);
  const hasData = hasTimeData(tasks);
  const warning = blackholeWarning(data);
  /** 有时间的任务数 / 总数：用来解释"为什么这条色带是空的" */
  const timedCount = tasks.filter((t) => windowLabel(t) !== null).length;
  const totalMinutes = data.stats.reduce((sum, s) => sum + s.totalMinutes, 0);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Activity className="size-4 text-cat-blackhole" />
          {isViewingToday ? "今日时间分布" : "该日时间分布"}
          <span className="font-normal text-subtle-foreground">24小时黑洞热力大盘</span>
        </h3>
        <p className="text-[11px] text-subtle-foreground">
          {hasData ? `已排布 ${fmtDuration(totalMinutes)} · ${timedCount}/${tasks.length} 项有时间` : "彩色带 · 一眼看穿失控时段"}
        </p>
      </div>

      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>板块耗时与明细切片</span>
            <div className="flex flex-wrap gap-2.5">
              {CATEGORY_ORDER.map((c) => (
                <span key={c} className="flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
                  <span className={cn("size-2 rounded-sm", CATEGORY_META[c].dot)} />
                  {CATEGORY_META[c].label}
                </span>
              ))}
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {/* 24 格热力条：整体透明度 70%，退居次位不喧宾夺主 */}
          <div>
            <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px] opacity-70">
              {data.hours.map((h) => (
                <div
                  key={h.hour}
                  data-heatmap-hour={h.hour}
                  data-heatmap-cat={h.category ?? ""}
                  data-heatmap-intensity={h.intensity}
                  title={`${String(h.hour).padStart(2, "0")}:00 · ${
                    h.category ? `${CATEGORY_META[h.category].label}（强度 ${h.intensity}）` : "无安排"
                  }`}
                  className={cn(
                    "h-9 rounded-[5px] transition-transform duration-150 hover:scale-y-110 sm:h-11",
                    h.category === null && "bg-white/[0.04]",
                    h.category && h.intensity > 0 && CELL_COLOR[h.category][h.intensity - 1],
                    h.category === "blackhole" && h.intensity === 3 && "animate-pulse-dot"
                  )}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] text-subtle-foreground">
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
          </div>

          {/* 空态：说清"为什么是空的"以及怎么把它填满，而不是留一片灰 */}
          {!hasData && (
            <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-white/12 bg-white/[0.02] px-3.5 py-3">
              <Clock3 className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {tasks.length === 0
                  ? "这一天还没有任务，热力图自然为空。新增任务后即会出现在这里。"
                  : `${tasks.length} 项任务都没有时间信息。点任务卡片左侧的「标记时间」标一段，或用 ▶ 计时，色带和切片会立刻出现。`}
              </p>
            </div>
          )}

          {/* 四大板块切片明细 */}
          <div className="grid gap-2 sm:grid-cols-2">
            {data.stats.map((stat) => {
              const meta = CATEGORY_META[stat.category];
              return (
                <div
                  key={stat.category}
                  data-stat={stat.category}
                  data-stat-total={stat.totalMinutes}
                  className={cn(
                    "rounded-xl border p-3",
                    stat.totalMinutes > 0 ? meta.border : "border-white/[0.07]",
                    stat.totalMinutes > 0 ? meta.bg : "bg-white/[0.02]"
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <p className={cn("text-xs font-medium", stat.totalMinutes > 0 ? meta.text : "text-subtle-foreground")}>
                      {meta.label}
                    </p>
                    <p
                      className={cn(
                        "font-mono text-sm font-light tabular-nums",
                        stat.totalMinutes > 0 ? "text-foreground" : "text-subtle-foreground"
                      )}
                    >
                      {stat.totalMinutes > 0 ? fmtDuration(stat.totalMinutes) : "—"}
                    </p>
                  </div>
                  {stat.slices.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {stat.slices.map((s, i) => (
                        <li
                          key={i}
                          className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
                        >
                          <span className="shrink-0 font-mono text-[10px] text-subtle-foreground">
                            {s.start}–{s.end}
                          </span>
                          <span className="truncate">{s.label}</span>
                          {s.runaway && (
                            <span className="shrink-0 rounded bg-cat-blackhole/15 px-1 py-px text-[9px] text-cat-blackhole">
                              失控
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-subtle-foreground">无记录</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* 黑洞警告：完全由真实失控切片拼出，没有失控段就不显示 */}
          {warning && (
            <p className="flex items-start gap-2 rounded-xl border border-cat-blackhole/20 bg-cat-blackhole/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-cat-blackhole/90">
              <AlarmClock className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
