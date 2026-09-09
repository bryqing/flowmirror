"use client";

import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TODAY_HEATMAP } from "@/lib/mock-data";
import { CATEGORY_META, type TaskCategory } from "@/lib/types";
import { cn, fmtDuration } from "@/lib/utils";

const CELL_COLOR: Record<TaskCategory, [string, string, string]> = {
  // intensity 1 / 2 / 3
  "deep-work": ["bg-cat-deep/20", "bg-cat-deep/45", "bg-cat-deep/75"],
  chore: ["bg-cat-chore/20", "bg-cat-chore/45", "bg-cat-chore/70"],
  blackhole: ["bg-cat-blackhole/25", "bg-cat-blackhole/55", "bg-cat-blackhole/85"],
  rest: ["bg-cat-rest/20", "bg-cat-rest/45", "bg-cat-rest/70"],
};

export function TimeHeatmap() {
  const { hours, stats } = TODAY_HEATMAP;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Activity className="size-4 text-cat-blackhole" />
          今日时间分布
          <span className="font-normal text-subtle-foreground">24小时黑洞热力大盘</span>
        </h3>
        <p className="text-[11px] text-subtle-foreground">彩色带 · 一眼看穿失控时段</p>
      </div>

      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>板块耗时与明细切片</span>
            <div className="flex flex-wrap gap-2.5">
              {(Object.keys(CATEGORY_META) as TaskCategory[]).map((c) => (
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
              {hours.map((h) => (
                <div
                  key={h.hour}
                  title={`${h.hour}:00 · ${h.category ? CATEGORY_META[h.category].label : "睡眠/空白"}`}
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

          {/* 四大板块切片明细 */}
          <div className="grid gap-2 sm:grid-cols-2">
            {stats.map((stat) => {
              const meta = CATEGORY_META[stat.category];
              return (
                <div
                  key={stat.category}
                  className={cn("rounded-xl border p-3", meta.border, meta.bg)}
                >
                  <div className="flex items-baseline justify-between">
                    <p className={cn("text-xs font-medium", meta.text)}>{meta.label}</p>
                    <p className="font-mono text-sm font-light tabular-nums text-foreground">
                      {fmtDuration(stat.totalMinutes)}
                    </p>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1">
                    {stat.slices.map((s, i) => (
                      <li key={i} className="flex items-baseline gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        <span className="shrink-0 font-mono text-[10px] text-subtle-foreground">
                          {s.start}–{s.end}
                        </span>
                        <span className="truncate">{s.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <p className="rounded-xl border border-cat-blackhole/20 bg-cat-blackhole/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-cat-blackhole/90">
            黑洞切片警告：今日黑洞共 2 小时 —— 刷短视频 12:30–13:00、21:00–22:00（其中 21 点后为重度失控段，计划外 60 分钟），游戏摸鱼 17:15–17:45。建议今晚 21 点前把手机物理隔离到客厅。
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
