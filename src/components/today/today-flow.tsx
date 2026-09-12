"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CornerUpLeft, Flame, Snowflake, Swords } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Button } from "@/components/ui/button";
import { CommandBar } from "@/components/layout/command-bar";
import { DateStrip } from "@/components/layout/date-strip";
import { MorningAnchor } from "./morning-anchor";
import { TaskQuadrants } from "./task-quadrants";
import { GlobalDispatchPanel } from "./global-dispatch-panel";
import { QuickCaptureSheet } from "./quick-capture-sheet";

export function TodayFlow() {
  const { tasks, careMode, unfreeze, selectedDate, isViewingToday, goToday } = useFlow();
  // 计数依赖 tasks 状态，而 tasks 在客户端会从本地快照/远程同步后变化，
  // SSR 与客户端首帧数量可能不一致。挂载后再渲染计数，避免 Hydration 警告。
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const activeCount = tasks.filter((t) => t.status === "pending" || t.status === "in-progress").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <section className="flex flex-col gap-4">
      {/* 区块标题：主战场入口（AI 速记 + 战局调度） */}
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Swords className="size-4 text-cat-deep" />
          今日战局
          <span className="hidden font-normal text-subtle-foreground sm:inline">
            Today&apos;s Flow · 主战场
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <p className="hidden text-[11px] text-subtle-foreground md:block">
            {mounted ? `${doneCount} 完成 · ${activeCount} 待处理` : "…"}
          </p>
          <QuickCaptureSheet />
          <GlobalDispatchPanel />
        </div>
      </div>

      {/* 顶部：自然语言调度输入框（静态通栏一行，不悬浮、不插入网格）+ 横向日期胶囊条 */}
      <CommandBar />
      <DateStrip />

      {/* 历史回看横幅：看板与灵感都在展示别的日子时，必须一眼可辨并一键返回 */}
      {mounted && !isViewingToday && (
        <div className="glass animate-fade-up flex flex-wrap items-center gap-3 rounded-2xl border-candle/25 p-3.5 glow-candle">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-candle/10">
            <CalendarClock className="size-4 text-candle" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-candle">
              历史回看 · <span className="font-mono">{selectedDate}</span>
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              四象限与灵感流均为该日数据；此时新增的任务会记在这一天。
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={goToday}
            className="border-candle/30 text-candle hover:bg-candle/10"
          >
            <CornerUpLeft className="size-3.5" />
            回到今天
          </Button>
        </div>
      )}

      {/* 中间：晨间金句锚点小卡片 */}
      <MorningAnchor />

      {/* 熔断关怀模式横幅 */}
      {careMode && (
        <div className="glass animate-fade-up flex flex-wrap items-center gap-3 rounded-2xl border-candle/25 p-4 glow-candle">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-candle/10">
            <Snowflake className="size-4 text-candle" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-candle">今日已熔断 · 治愈关怀模式</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              剩余待办已冷冻，没有负罪感。休息是战略撤退，不是溃败。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={unfreeze} className="border-candle/30 text-candle hover:bg-candle/10">
            解冻再战
          </Button>
        </div>
      )}

      {/* 核心：2x2 四象限紧凑网格大盘 */}
      <TaskQuadrants />

      {!careMode && (
        <p className="flex items-center justify-center gap-1.5 pt-0.5 text-center text-[11px] text-subtle-foreground">
          <Flame className="size-3" />
          点击任意任务卡片打开详情与战前锦囊；打钩或倒计时结束后自动唤起微复盘
        </p>
      )}
    </section>
  );
}
