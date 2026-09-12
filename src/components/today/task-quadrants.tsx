"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  Snowflake,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { TaskTimePopover } from "@/components/ui/task-time-popover";
import {
  CATEGORY_META,
  QUADRANT_META,
  QUADRANT_ORDER,
  type Task,
  type TaskCategory,
} from "@/lib/types";
import { isTiming, openSliceStart, recordedMinutes, windowLabel } from "@/lib/task-time";
import { cn, fmtDuration } from "@/lib/utils";

/**
 * 四象限看板顺序与文案统一由 QUADRANT_META 提供（q1 紧急重要 → q4 休闲娱乐），
 * 这里不再本地维护名称，避免出现第二份文案源。
 */

/** 圆环进度圈配色（与分类令牌一致） */
const RING_COLORS: Record<TaskCategory, string> = {
  "deep-work": "#67e8f9",
  chore: "#a5b4fc",
  blackhole: "#fb7185",
  rest: "#6ee7b7",
};

export function TaskQuadrants() {
  const { tasks, openDetail, completeTask, addTask, deleteTask, pushToast, setTaskTime, toggleTiming } =
    useFlow();

  // mounted：SSR 与客户端首帧渲染占位，挂载后再展示动态任务数据，
  // 避免任务列表（本地快照/远程）在首帧与 SSR 不一致导致 Hydration 报错。
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // 正在就地录入的象限。全局只允许一个，避免多个输入框同时抢焦点。
  const [addingIn, setAddingIn] = useState<TaskCategory | null>(null);

  const handleAdd = async (title: string, category: TaskCategory) => {
    try {
      await addTask(title, category);
      pushToast(`已添加到「${CATEGORY_META[category].label}」`, "success");
    } catch (err) {
      // addTask 已先落本地 + 入离线队列，网络异常只意味着延后同步，不是失败
      console.warn("[FlowMirror] 新增任务云端同步异常（已入离线队列待补录）：", err);
      pushToast("任务已加入看板，云端稍后自动补录", "warn");
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {QUADRANT_ORDER.map((q, qi) => {
        const { category, hint } = QUADRANT_META[q];
        const meta = CATEGORY_META[category];
        const list = tasks.filter((t) => t.category === category);
        const total = list.reduce((sum, t) => sum + (t.plannedDuration ?? 0), 0);
        const doneCount = list.filter((t) => t.status === "done").length;
        const progress = list.length > 0 ? doneCount / list.length : 0;
        const active = list.some((t) => t.status === "in-progress");
        const adding = addingIn === category;

        return (
          <section
            key={category}
            className={cn(
              // ⚠️ `min-w-0` 不能删：grid 子项的 `min-width` 默认是 `auto`，
              // 列宽会被子项的 min-content 顶开。卡片行里有一串 shrink-0 的控件
              // （打钩 / 时间入口 / 计时 / 删除 / 箭头），min-content 加起来远超
              // 390px 的手机宽度 → 整页横向滚动（实测 553 > 390）。
              // 加上它之后列宽改由容器决定（回到 390），卡片行内部再自行收缩。
              "glass glow-edge animate-fade-up flex min-h-[175px] min-w-0 flex-col rounded-2xl p-5",
              active && category === "blackhole" && "border-cat-blackhole/25",
              active && category !== "blackhole" && "border-cat-deep/20",
              adding && meta.border
            )}
            style={{ animationDelay: `${qi * 0.07}s` }}
          >
            {/* 象限头：编号 Q1~Q4 + 名称 + 计数 + 计划时长 + 象限内新增 + 完成率圆环 */}
            <header className="flex min-h-[36px] items-center gap-2 px-1 pb-4">
              <span className={cn("size-2 rounded-full", meta.dot, active && "animate-pulse-dot")} />
              <p className={cn("flex items-baseline gap-1.5 text-xs font-semibold tracking-tight", meta.text)}>
                <span className="font-mono text-[10px] font-normal opacity-60">{q.toUpperCase()}</span>
                {meta.label}
              </p>
              <span className="rounded-full bg-white/[0.06] px-1.5 py-px font-mono text-[10px] text-zinc-400">
                {mounted ? list.length : 0}
              </span>
              <span className="ml-auto font-mono text-[10px] text-zinc-400">
                {mounted ? (total > 0 ? fmtDuration(total) : hint) : hint}
              </span>
              <button
                onClick={() => setAddingIn((cur) => (cur === category ? null : category))}
                aria-label={`在「${meta.label}」中添加任务`}
                aria-expanded={adding}
                title={`在「${meta.label}」中添加任务`}
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  adding
                    ? cn(meta.border, meta.bg, meta.text)
                    : "border-white/10 text-subtle-foreground hover:border-white/25 hover:text-foreground"
                )}
              >
                <Plus
                  className={cn("size-3 transition-transform duration-200", adding && "rotate-45")}
                />
              </button>
              <RingProgress
                value={mounted ? progress : 0}
                color={RING_COLORS[category]}
                done={mounted ? doneCount : 0}
                total={mounted ? list.length : 0}
              />
            </header>

            {/* 任务芯片：条目间 space-y-2.5 呼吸间距 */}
            <div className="flex flex-1 flex-col gap-2.5">
              {!mounted && (
                <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/[0.07] py-6 text-[11px] text-zinc-500">
                  …
                </p>
              )}
              {mounted && list.length === 0 && (
                <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/[0.07] py-6 text-[11px] text-zinc-500">
                  暂无安排
                </p>
              )}
              {mounted &&
                list.map((task) => (
                  <TaskChip
                    key={task.id}
                    task={task}
                    onOpen={() => openDetail(task.id)}
                    onComplete={() => completeTask(task.id)}
                    onSetTime={(start, duration) => setTaskTime(task.id, start, duration)}
                    onToggleTiming={() => toggleTiming(task.id)}
                    onDelete={() => {
                      deleteTask(task.id);
                      pushToast(`已删除「${task.title}」`, "info");
                    }}
                  />
                ))}

              {/* 就地新增：仅当前展开的象限渲染，回车即存并可连续录入 */}
              {adding && (
                <AddTaskRow
                  accentBorder={meta.border}
                  accentDot={meta.dot}
                  onCancel={() => setAddingIn(null)}
                  onSubmit={(title) => handleAdd(title, category)}
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * 象限内就地新增任务行。
 *
 * 保存成功后**保持展开并清空输入、重新聚焦** —— 连续录入多条时不必反复点加号；
 * 结束时按 ESC 或点已变成 × 的按钮收起。
 *
 * ⚠️ 清空必须发生在 `await` **之前**：云端写入要走一次网络往返（国内经同源代理
 * 通常数百毫秒），若等回执再清空，用户在等待期间敲下的下一条会被一并抹掉。
 * 任务本身是乐观落进看板的，先清空不会有"点了没反应"的问题。
 */
function AddTaskRow({
  accentBorder,
  accentDot,
  onCancel,
  onSubmit,
}: {
  accentBorder: string;
  accentDot: string;
  onCancel: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const title = value.trim();
    if (!title) return;
    setValue(""); // 先清空，保证能立刻录下一条
    setSaving(true);
    try {
      await onSubmit(title);
    } catch (err) {
      // 兜底：内容还给用户，不让他白打一遍（正常路径下 addTask 不会抛）
      console.warn("[FlowMirror] 就地新增失败：", err);
      setValue((cur) => (cur.trim().length === 0 ? title : cur));
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-xl border bg-white/[0.04] px-2 py-1.5",
        accentBorder
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", accentDot)} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="输入任务标题，回车保存"
        maxLength={120}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-xs text-foreground outline-none placeholder:text-subtle-foreground"
      />
      <button
        onClick={() => void submit()}
        disabled={value.trim().length === 0}
        aria-label="保存任务"
        title="保存（回车）"
        className="flex size-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-cat-rest/15 hover:text-cat-rest disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-subtle-foreground"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      </button>
      <button
        onClick={onCancel}
        aria-label="取消添加"
        title="取消（ESC）"
        className="flex size-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
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

/**
 * 任务芯片。
 *
 * 删除采用**行内二次确认**而非 window.confirm：任务可能挂着微复盘、
 * 时间切片等不可再生数据，误删代价高；而原生弹窗会打断视觉风格。
 * 确认态直接复用同一条目占位，不撑高卡片，也不会造成列表跳动。
 */
function TaskChip({
  task,
  onOpen,
  onComplete,
  onSetTime,
  onToggleTiming,
  onDelete,
}: {
  task: Task;
  onOpen: () => void;
  onComplete: () => void;
  onSetTime: (startClock: string | undefined, durationMin: number | undefined) => void;
  onToggleTiming: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const frozen = task.status === "frozen";
  const done = task.status === "done";
  const running = task.status === "in-progress";
  const isBlackhole = task.category === "blackhole";
  /** 是否正在计时（存在未闭合的时间切片） */
  const timing = isTiming(task);
  const timingSince = openSliceStart(task);
  /** 已记录时长（真实计时累计） */
  const recorded = recordedMinutes(task);

  if (confirming) {
    return (
      <div className="-mx-2 flex items-center gap-2 rounded-lg border border-cat-blackhole/30 bg-cat-blackhole/[0.08] px-2 py-2.5">
        <Trash2 className="size-3.5 shrink-0 text-cat-blackhole" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-cat-blackhole/90">
          删除「{task.title}」？
        </span>
        <button
          onClick={onDelete}
          className="shrink-0 rounded-md bg-cat-blackhole/15 px-2 py-1 text-[10px] font-medium text-cat-blackhole transition-colors hover:bg-cat-blackhole/25"
        >
          删除
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="shrink-0 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
        >
          取消
        </button>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // 卡片里嵌了时间段入口、计时、打钩、删除等控件，它们自己会处理 Enter；
        // 只有焦点落在卡片本体时才打开详情，否则会在抽屉里再叠一层。
        if (e.target !== e.currentTarget) return;
        onOpen();
      }}
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

      {/* 时间段入口：既显示窗口，也是热力大盘的数据来源（点击可改） */}
      <TaskTimePopover
        value={task.scheduledTime}
        duration={task.plannedDuration}
        label={windowLabel(task)}
        onChange={onSetTime}
        disabled={frozen}
        className={done ? "line-through opacity-70" : undefined}
      />

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          done ? "text-zinc-500 line-through" : "font-medium text-zinc-100"
        )}
      >
        {task.title}
      </span>

      {/* 轻量计时：开始 / 结束，结束时累计进 actualDuration 并驱动热力大盘 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleTiming();
        }}
        disabled={frozen || done}
        aria-label={timing ? `结束计时「${task.title}」` : `开始计时「${task.title}」`}
        title={timing ? "结束计时" : "开始计时"}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
          timing
            ? "bg-cat-deep/20 text-cat-deep hover:bg-cat-deep/30"
            : "text-subtle-foreground/70 hover:bg-cat-deep/15 hover:text-cat-deep",
          (frozen || done) && "cursor-not-allowed opacity-40"
        )}
      >
        {timing ? <Square className="size-3 fill-current" /> : <Play className="size-3.5" />}
      </button>

      {frozen && <Snowflake className="size-3 shrink-0 text-cat-chore" />}

      {/* 暂停/进行中标识 */}
      {running && !timing && !isBlackhole && <Play className="size-3 shrink-0 text-cat-deep" />}
      {timing && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums",
            isBlackhole ? "text-cat-blackhole" : "text-cat-deep"
          )}
          title={`自 ${timingSince} 起计时中`}
        >
          <span
            className={cn(
              "size-1.5 animate-pulse-dot rounded-full",
              isBlackhole ? "bg-cat-blackhole" : "bg-cat-deep"
            )}
          />
          计时{timingSince ? ` ${timingSince}` : "中"}
        </span>
      )}

      {/* 已记录时长（非计时状态下展示真实累计） */}
      {!timing && recorded > 0 && (
        <span
          className="shrink-0 rounded bg-white/[0.06] px-1 py-px font-mono text-[9px] tabular-nums text-zinc-400"
          title={`已记录 ${fmtDuration(recorded)}`}
        >
          已记{fmtDuration(recorded)}
        </span>
      )}

      {done && task.microReviews.length > 0 && (
        <span className="shrink-0 rounded bg-cat-rest/15 px-1 py-px text-[9px] text-cat-rest">已复盘</span>
      )}

      {/* 删除入口：常显（移动端无悬浮态，靠 hover 才出现等于不可用） */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        aria-label={`删除任务「${task.title}」`}
        title="删除任务"
        className="flex size-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground/70 transition-colors hover:bg-cat-blackhole/15 hover:text-cat-blackhole"
      >
        <Trash2 className="size-3.5" />
      </button>

      <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
