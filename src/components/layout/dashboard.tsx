"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SectionNav, type SectionId } from "@/components/layout/section-nav";
import { MorningAnchor } from "@/components/today/morning-anchor";
import { YesterdayMirror } from "@/components/mirror/yesterday-mirror";
import { TodayFlow } from "@/components/today/today-flow";
import { TaskQuadrants } from "@/components/today/task-quadrants";
import { TimeHeatmap } from "@/components/heatmap/time-heatmap";
import { ThoughtStream } from "@/components/thoughts/thought-stream";

/**
 * 主页看板：晨间心锚常驻顶部，下方是五大板块的一级导航 + 单页切换主体。
 *
 * 切换策略：五个板块**全部常驻挂载**，仅用 `hidden` 切换可见性 ——
 * 切 tab 是纯 CSS 显隐，不卸载、不重新拉数据，因此无闪烁、无重复请求，
 * 也保留了各板块的内部状态（灵感库的输入、热力图的滚动等）。
 * 默认进入「今日战局」。
 */
export function Dashboard() {
  const [active, setActive] = useState<SectionId>("battle");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-4 sm:gap-5 sm:px-6">
      {/* 晨间心锚：每日第一眼，常驻最顶 */}
      <MorningAnchor />

      {/* 五大板块横向一级入口 */}
      <SectionNav active={active} onChange={setActive} />

      {/* 单页主体：只展示当前板块，无需上下长距离滚动 */}
      <div className={cn(active === "mirror" ? "" : "hidden")}>
        <YesterdayMirror />
      </div>

      <div className={cn(active === "battle" ? "" : "hidden")}>
        <TodayFlow />
      </div>

      <div className={cn(active === "backlog" ? "" : "hidden")}>
        <TaskQuadrants mode="backlog" />
      </div>

      <div className={cn(active === "timeline" ? "" : "hidden")}>
        <TimeHeatmap />
      </div>

      <div className={cn(active === "thoughts" ? "" : "hidden")}>
        <ThoughtStream />
      </div>
    </main>
  );
}
