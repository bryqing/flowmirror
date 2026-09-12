"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, X } from "lucide-react";
import { DarkSelect, type DarkSelectOption } from "./dark-select";
import { cn } from "@/lib/utils";
import { minutesToClock, toMinutes } from "@/lib/task-time";

/**
 * 轻量「时间段标记」弹层 —— 任务卡片上的时间入口，也是热力大盘的数据来源。
 *
 * 为什么不用原生 `<input type="time">`：
 *   与原生 `<select>` 同一个坑 —— 弹出部分由操作系统渲染，暗色主题下不可控；
 *   而且桌面端要点两下箭头、移动端要滚轮，对「随手标一下这段时间」太重。
 *   这里改成 时/分 两个下拉（复用已经验证过的 `ui/dark-select.tsx`）+ 时长胶囊，
 *   两次点击就能标完一段。
 *
 * 沿用同类浮层的三条铁律（与 calendar-popover / dark-select 一致）：
 *   1. **Portal 到 document.body** —— 调用方在四象限卡片里，祖先带 `overflow`，
 *      普通绝对定位会被裁掉。
 *   2. **实色 `bg-elevated`** —— 不用半透明 + blur，杜绝底色透白、文字发灰。
 *   3. **定位先判上下翻转，再无条件钳进视口** —— 只翻转不够，触发器贴底时仍会溢出。
 *
 * ⚠️ 额外一个坑：面板里内嵌了 DarkSelect，而 DarkSelect 的菜单同样是 Portal 到
 *    body 的。于是「点菜单选项」在 DOM 上看起来是**面板外的点击**，外点关闭逻辑会
 *    误判并把整个面板关掉（表现为「下拉一选就全没了」）。所以外点与 ESC 都必须
 *    先排除 `[role="listbox"]`。
 */

interface TaskTimePopoverProps {
  /** 当前开始时刻 "HH:mm"（无则 undefined） */
  value?: string;
  /** 当前时长（分钟，无则 undefined） */
  duration?: number;
  /** 卡片上显示的窗口文案，如 "09:30–11:00" */
  label: string | null;
  disabled?: boolean;
  onChange: (startClock: string | undefined, durationMin: number | undefined) => void;
  className?: string;
}

const GAP = 8;
const EDGE = 8;
const PANEL_WIDTH = 268;

/** 时长预设（分钟）：番茄钟 / 半小时 / 整点 / 深工作块 */
const DURATION_PRESETS = [15, 25, 45, 60, 90, 120] as const;

const HOUR_OPTIONS: DarkSelectOption<string>[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: String(h).padStart(2, "0"),
}));

/** 分钟按 5 分钟步进 —— 热力图的粒度是小时，标到分钟级已经足够 */
const MINUTE_OPTIONS: DarkSelectOption<string>[] = Array.from({ length: 12 }, (_, i) => ({
  value: String(i * 5),
  label: String(i * 5).padStart(2, "0"),
}));

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function TaskTimePopover({
  value,
  duration,
  label,
  disabled = false,
  onChange,
  className,
}: TaskTimePopoverProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  /** 面板内的草稿值：点「完成」才提交，中途改主意可直接关掉 */
  const [draftHour, setDraftHour] = useState("9");
  const [draftMinute, setDraftMinute] = useState("30");
  const [draftDuration, setDraftDuration] = useState<number | undefined>(duration);
  /** 是否处于「已设定开始时刻」状态（清除后为 false，但仍可点时长重新开始） */
  const [hasStart, setHasStart] = useState(false);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const openPanel = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    // 用当前值初始化草稿；没有开始时刻时默认落在「现在」最近的一个 5 分钟刻度
    const start = toMinutes(value);
    if (start === null) {
      const now = new Date();
      setDraftHour(String(now.getHours()));
      setDraftMinute(String(Math.floor(now.getMinutes() / 5) * 5));
      setHasStart(false);
    } else {
      setDraftHour(String(Math.floor(start / 60)));
      setDraftMinute(String(start % 60));
      setHasStart(true);
    }
    setDraftDuration(duration);
    setRect(el.getBoundingClientRect());
    setOpen(true);
  }, [value, duration]);

  // 打开期间跟随滚动 / 缩放重算位置（捕获阶段才能覆盖内部滚动容器）
  useEffect(() => {
    if (!open) return;
    const sync = () => {
      const el = triggerRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [open]);

  useIsoLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (el) setPanelHeight(el.offsetHeight);
  }, [open]);

  // 外点关闭 + ESC 关闭（均需排除内嵌 DarkSelect 的 Portal 菜单，见文件头注释）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[role="listbox"]')) return;
      setOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 子级下拉展开时 ESC 归它处理，否则一次键关两层
      if (document.querySelector('[role="listbox"]')) return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const startHour = Number(draftHour);
  const startMinute = Number(draftMinute);
  const startClock = `${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}`;
  const previewEnd = useMemo(() => {
    if (!draftDuration) return null;
    return minutesToClock(startHour * 60 + startMinute + draftDuration);
  }, [draftDuration, startHour, startMinute]);

  const commit = () => {
    onChange(draftDuration || hasStart ? startClock : undefined, draftDuration);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const clear = () => {
    onChange(undefined, undefined);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** 定位：默认向下，下方放不下且上方更宽裕时翻上去；最终纵横都钳进视口 */
  const layout = (() => {
    if (!rect || typeof window === "undefined") return null;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const width = Math.min(PANEL_WIDTH, viewportW - EDGE * 2);
    const left = Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, viewportW - width - EDGE));
    const measured = panelHeight || 300;
    const spaceBelow = viewportH - rect.bottom - GAP - EDGE;
    const spaceAbove = rect.top - GAP - EDGE;
    const flip = measured > spaceBelow && spaceAbove > spaceBelow;
    const desired = flip ? rect.top - GAP - measured : rect.bottom + GAP;
    const top = Math.max(EDGE, Math.min(desired, viewportH - EDGE - measured));
    return { left, top, width };
  })();

  const marked = Boolean(value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-task-time-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label ? `时间段 ${label}，点击修改` : "标记时间段"}
        title={label ? `${label} · 点击修改时间段` : "点击标记时间段（驱动热力大盘）"}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation(); // 卡片整体是可点开的，别让点时间把抽屉带出来
          if (open) setOpen(false);
          else openPanel();
        }}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors",
          marked
            ? "text-zinc-300 hover:bg-cat-deep/15 hover:text-cat-deep"
            : "text-subtle-foreground hover:bg-white/[0.08] hover:text-foreground",
          open && "bg-cat-deep/15 text-cat-deep",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        <Clock className="size-2.5 shrink-0 opacity-70" />
        {label ? (
          <>
            {/* 窄屏只显示开始时刻：完整窗口 "09:30–11:00" 会把标题挤没 */}
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.split("–")[0]}</span>
          </>
        ) : (
          "标记时间"
        )}
      </button>

      {open &&
        layout &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="标记时间段"
            data-task-time-popover
            style={{ left: layout.left, top: layout.top, width: layout.width }}
            className="animate-fade-in fixed z-[200] rounded-xl border border-white/12 bg-elevated p-3 shadow-[0_24px_55px_-16px_rgba(0,0,0,0.92)] ring-1 ring-black/40"
          >
            <div className="flex items-center justify-between gap-2 pb-2.5">
              <p className="text-xs font-medium text-foreground">标记时间段</p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="关闭"
                className="flex size-5 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>

            {/* 开始时刻：两个自绘下拉，避免原生 time 控件在暗色下不可控 */}
            <div className="flex items-end gap-1.5">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[10px] text-subtle-foreground">开始</span>
                <DarkSelect
                  value={draftHour}
                  options={HOUR_OPTIONS}
                  onChange={(v) => {
                    setDraftHour(v);
                    setHasStart(true);
                  }}
                  ariaLabel="开始小时"
                  className="w-full justify-between py-1"
                />
              </label>
              <span className="pb-1.5 font-mono text-xs text-subtle-foreground">:</span>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[10px] text-subtle-foreground">分</span>
                <DarkSelect
                  value={draftMinute}
                  options={MINUTE_OPTIONS}
                  onChange={(v) => {
                    setDraftMinute(v);
                    setHasStart(true);
                  }}
                  ariaLabel="开始分钟"
                  className="w-full justify-between py-1"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  setDraftHour(String(now.getHours()));
                  setDraftMinute(String(Math.floor(now.getMinutes() / 5) * 5));
                  setHasStart(true);
                }}
                className="shrink-0 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-[10px] text-muted-foreground transition-colors hover:border-cat-deep/35 hover:text-cat-deep"
              >
                现在
              </button>
            </div>

            {/* 时长预设 */}
            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-[10px] text-subtle-foreground">时长</span>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((m) => {
                  const active = draftDuration === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      data-duration={m}
                      onClick={() => {
                        setDraftDuration(active ? undefined : m);
                        setHasStart(true);
                      }}
                      className={cn(
                        "rounded-lg border px-2 py-1 font-mono text-[10px] tabular-nums transition-colors",
                        active
                          ? "border-cat-deep/45 bg-cat-deep/15 text-cat-deep"
                          : "border-white/10 bg-white/[0.04] text-muted-foreground hover:border-white/25 hover:text-foreground"
                      )}
                    >
                      {m < 60 ? `${m}分` : `${m / 60}小时`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 预览 + 操作 */}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-2.5">
              <span className="font-mono text-[10px] tabular-nums text-subtle-foreground">
                {previewEnd ? `${startClock}–${previewEnd}` : startClock}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                >
                  清除
                </button>
                <button
                  type="button"
                  data-time-confirm
                  onClick={commit}
                  className="rounded-md bg-cat-deep/15 px-2.5 py-1 text-[10px] font-medium text-cat-deep transition-colors hover:bg-cat-deep/25"
                >
                  完成
                </button>
              </div>
            </div>

            <p className="mt-2 text-[10px] leading-relaxed text-subtle-foreground">
              标记后会占用该时段并同步到热力大盘；重新标记会清空该任务已记录的计时。
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
