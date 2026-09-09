"use client";

import { Check, ChevronRight, Play, Snowflake } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { CATEGORY_META, type Task, type TaskCategory } from "@/lib/types";
import { cn, fmtDuration } from "@/lib/utils";

/** 四象限顺序：深度工作 → 日常杂务 → 娱乐黑洞 → 休息恢复 */
const QUADRANTS: { category: TaskCategory; hint: string }[] = [
  { category: "deep-work", hint: "高价值产出，优先保护" },
  { category: "chore", hint: "批量处理，限时收口" },
  { category: "blackhole", hint: "计划外黑洞，到点刹车" },
  { category: "rest", hint: "主动恢复，不带手机" },
];

/** 圆环进度圈配色（与分类令牌一致） */
const RING_COLORS: Record<TaskCategory, string> = {
  "deep-work": "#67e8f9",
  chore: "#a5b4fc",
  blackhole: "#fb7185",
  rest: "#6ee7b7",
};

export function TaskQuadrants() {
  const { tasks, openDetail, completeTask } = useFlow();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {QUADRANTS.map(({ category, hint }, qi) => {
        const meta = CATEGORY_META[category];
        const list = tasks.filter((t) => t.category === category);
        const total = list.reduce((sum, t) => sum + (t.plannedDuration ?? 0), 0);
        const doneCount = list.filter((t) => t.status === "done").length;
        const progress = list.length > 0 ? doneCount / list.length : 0;
        const active = list.some((t) => t.status === "in-progress");

        return (
          <section
            key={category}
            className={cn(
              "glass glow-edge animate-fade-up flex min-h-[175px] flex-col rounded-2xl p-5",
              active && category === "blackhole" && "border-cat-blackhole/25",
              active && category !== "blackhole" && "border-cat-deep/20"
            )}
            style={{ animationDelay: `${qi * 0.07}s` }}
          >
            {/* 象限头：名称 + 计数 + 计划时长 + 右上角圆环进度圈（与标题水平居中对齐） */}
            <header className="flex min-h-[36px] items-center gap-2 px-1 pb-4">
              <span className={cn("size-2 rounded-full", meta.dot, active && "animate-pulse-dot")} />
              <p className={cn("text-xs font-semibold tracking-tight", meta.text)}>{meta.label}</p>
              <span className="rounded-full bg-white/[0.06] px-1.5 py-px font-mono text-[10px] text-zinc-400">
                {list.length}
              </span>
              <span className="ml-auto font-mono text-[10px] text-zinc-400">
                {total > 0 ? fmtDuration(total) : hint}
              </span>
              <RingProgress value={progress} color={RING_COLORS[category]} done={doneCount} total={list.length} />
            </header>

            {/* 任务芯片：条目间 space-y-2.5 呼吸间距 */}
            <div className="flex flex-1 flex-col gap-2.5">
              {list.length === 0 && (
                <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/[0.07] py-6 text-[11px] text-zinc-500">
                  暂无安排
                </p>
              )}
              {list.map((task) => (
                <TaskChip
                  key={task.id}
                  task={task}
                  onOpen={() => openDetail(task.id)}
                  onComplete={() => completeTask(task.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 右上角 SVG 圆环进度圈：展示该象限任务完成率 */
function RingProgress({
  value,
  color,
  done,
  total,
}: {
  value: number;
  color: string;
  done: number;
  total: number;
}) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value));
  return (
    <span
      className="relative ml-1 inline-flex size-9 shrink-0 items-center justify-center"
      title={`完成进度 ${done}/${total} · ${Math.round(pct * 100)}%`}
    >
      <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{
            transition: "stroke-dasharray 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: `drop-shadow(0 0 4px ${color}66)`,
          }}
        />
      </svg>
      <span className="absolute font-mono text-[9px] font-medium tabular-nums text-zinc-300">
        {total === 0 ? "—" : `${Math.round(pct * 100)}%`}
      </span>
    </span>
  );
}

function TaskChip({
  task,
  onOpen,
  onComplete,
}: {
  task: Task;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const frozen = task.status === "frozen";
  const done = task.status === "done";
  const running = task.status === "in-progress";
  const isBlackhole = task.category === "blackhole";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cn(
        "group -mx-2 flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-2.5 transition-colors duration-200",
        "hover:bg-white/[0.04]",
        frozen && "opacity-45 saturate-50",
        done && "opacity-60",
        running && isBlackhole && "bg-cat-blackhole/[0.08] hover:bg-cat-blackhole/[0.12]",
        running && !isBlackhole && "bg-cat-deep/[0.07] hover:bg-cat-deep/[0.11]"
      )}
    >
      {/* 快速打钩（不打开抽屉） */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!frozen && !done) onComplete();
        }}
        disabled={frozen || done}
        aria-label={done ? "已完成" : "标记完成并微复盘"}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-all",
          done
            ? "border-cat-rest bg-cat-rest text-background"
            : "border-white/25 text-transparent hover:border-cat-rest hover:text-cat-rest/60",
          frozen && "cursor-not-allowed"
        )}
      >
        <Check className="size-2.5" strokeWidth={3.5} />
      </button>

      <span
        className={cn(
          "shrink-0 font-mono text-[10px] tabular-nums",
          done ? "text-zinc-500 line-through" : "text-zinc-400"
        )}
      >
        {task.scheduledTime ?? "--:--"}
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          done ? "text-zinc-500 line-through" : "font-medium text-zinc-100"
        )}
      >
        {task.title}
      </span>

      {frozen && <Snowflake className="size-3 shrink-0 text-cat-chore" />}
      {running && !isBlackhole && <Play className="size-3 shrink-0 text-cat-deep" />}
      {running && isBlackhole && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-cat-blackhole">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-cat-blackhole" />
          计时中
        </span>
      )}
      {done && task.microReviews.length > 0 && (
        <span className="shrink-0 rounded bg-cat-rest/15 px-1 py-px text-[9px] text-cat-rest">已复盘</span>
      )}

      <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
