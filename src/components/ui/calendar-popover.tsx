"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 暗黑风格日历弹层（Calendar Popover）
 *
 * 用途：日期栏右侧的「回看灵感」按钮 —— 需要能跳到**任意历史/未来日期**，
 * 而固定胶囊条最多只能铺几天，所以补一个可翻月的日历。
 *
 * 与 `ui/dark-select.tsx` 同样的三个关键点（都是踩过的坑）：
 *   1. **Portal 到 document.body**：调用方（日期栏）本身是 `overflow-x-auto`，
 *      普通绝对定位的弹层会被滚动容器裁掉下半截。
 *   2. **ESC 在捕获阶段 stopPropagation**：外层若也监听 ESC（抽屉等），
 *      不抢先拦截就会一次键关两层。
 *   3. **实色暗底**：不用半透明 + blur，彻底杜绝底色透白、文字发灰。
 *
 * 日期一律用**本地时区**拼 `YYYY-MM-DD`（不能用 toISOString —— UTC 会在
 * GMT+8 的凌晨把日期算差一天，导致筛选到隔壁那天）。
 */

interface CalendarPopoverProps {
  /** 当前选中日期 `YYYY-MM-DD` */
  value: string;
  onChange: (dateKey: string) => void;
  /** 今天 `YYYY-MM-DD`（高亮 + 「回到今天」用） */
  today: string;
  /** 触发器文案 */
  label?: string;
  className?: string;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const GAP = 8;
const EDGE = 8;
/** 日历宽度：7 列 × 32px + 内边距 */
const PANEL_WIDTH = 268;

/** Date → 本地时区 `YYYY-MM-DD` */
function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** `YYYY-MM-DD` → 本地 Date（用当日 0 点，避开时区偏移） */
function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** SSR 阶段没有 useLayoutEffect，退化为 useEffect */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function CalendarPopover({ value, onChange, today, label = "回看灵感", className }: CalendarPopoverProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  /** 当前展示的月份（取该月 1 号） */
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = fromKey(value);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const openPanel = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const d = fromKey(value);
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setRect(el.getBoundingClientRect());
    setOpen(true);
  }, [value]);

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

  // 量真实高度，用于判断向下还是向上展开
  useIsoLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (el) setPanelHeight(el.offsetHeight);
  }, [open, viewMonth]);

  // 外点关闭 + ESC 关闭（捕获阶段抢占，避免连带关闭外层）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
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

  /** 网格：前置空白 + 当月每天 */
  const cells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const lead = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const list: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= total; day++) list.push(toKey(new Date(year, month, day)));
    return list;
  }, [viewMonth]);

  const shiftMonth = (delta: number) =>
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  const pick = (dateKey: string) => {
    onChange(dateKey);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** 定位：默认向下，下方放不下且上方更宽裕时翻上去；最终纵横都钳进视口 */
  const layout = (() => {
    if (!rect || typeof window === "undefined") return null;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const width = Math.min(PANEL_WIDTH, viewportW - EDGE * 2);
    const left = Math.min(
      Math.max(EDGE, rect.right - width),
      Math.max(EDGE, viewportW - width - EDGE)
    );
    const measured = panelHeight || 330;
    const spaceBelow = viewportH - rect.bottom - GAP - EDGE;
    const spaceAbove = rect.top - GAP - EDGE;
    const flip = measured > spaceBelow && spaceAbove > spaceBelow;
    const desired = flip ? rect.top - GAP - measured : rect.bottom + GAP;
    // ⚠️ 只做「上/下翻转」是不够的：触发器本身贴近视口底部时，上方空间也可能不够
    //（例如 trigger.bottom≈900 而视口高 900，翻上去反而顶到 927）。所以最后必须
    // 无条件把 top 钳进 [EDGE, viewportH - EDGE - measured]，保证整块面板可见。
    const top = Math.max(EDGE, Math.min(desired, viewportH - EDGE - measured));
    return { left, top, width };
  })();

  const viewYear = viewMonth.getFullYear();
  const viewMonthIndex = viewMonth.getMonth();
  const isViewingTodayMonth =
    viewYear === fromKey(today).getFullYear() && viewMonthIndex === fromKey(today).getMonth();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`选择日期，当前 ${value}`}
        title="打开日历，回看任意历史日期"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-[11px] text-muted-foreground transition-colors",
          "hover:border-cat-deep/35 hover:bg-cat-deep/10 hover:text-cat-deep",
          open && "border-cat-deep/40 text-cat-deep",
          className
        )}
      >
        <CalendarDays className="size-3.5" />
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open &&
        layout &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="选择日期"
            style={{ left: layout.left, top: layout.top, width: layout.width }}
            className="animate-fade-in fixed z-[200] rounded-xl border border-white/12 bg-elevated p-2.5 shadow-[0_24px_55px_-16px_rgba(0,0,0,0.92)] ring-1 ring-black/40"
          >
            {/* 月份切换 */}
            <div className="flex items-center justify-between gap-1 px-0.5 pb-2">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="上个月"
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <p className="font-mono text-[11px] font-medium tabular-nums text-foreground">
                {viewYear} 年 {viewMonthIndex + 1} 月
              </p>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="下个月"
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>

            {/* 星期表头 */}
            <div className="grid grid-cols-7 gap-0.5 pb-1">
              {WEEKDAYS.map((w) => (
                <span
                  key={w}
                  className="flex h-6 items-center justify-center text-[10px] text-subtle-foreground"
                >
                  {w}
                </span>
              ))}
            </div>

            {/* 日期网格 */}
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((key, i) => {
                if (!key) return <span key={`blank-${i}`} className="h-8" />;
                const isSelected = key === value;
                const isToday = key === today;
                const dayNum = Number(key.slice(-2));
                return (
                  <button
                    key={key}
                    type="button"
                    data-date={key}
                    aria-label={key}
                    aria-current={isSelected ? "date" : undefined}
                    onClick={() => pick(key)}
                    className={cn(
                      "relative flex h-8 items-center justify-center rounded-lg font-mono text-[11px] tabular-nums transition-colors",
                      isSelected
                        ? "bg-cat-deep/20 font-medium text-cat-deep ring-1 ring-cat-deep/45"
                        : isToday
                          ? "text-foreground hover:bg-white/[0.08]"
                          : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
                    )}
                  >
                    {dayNum}
                    {isToday && (
                      <span
                        className={cn(
                          "absolute bottom-1 size-1 rounded-full",
                          isSelected ? "bg-cat-deep" : "bg-cat-deep/60"
                        )}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* 回到今天 */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.07] px-0.5 pt-2">
              <span className="text-[10px] text-subtle-foreground">
                {value === today ? "正在查看今天" : `已选 ${value}`}
              </span>
              <button
                type="button"
                onClick={() => pick(today)}
                disabled={value === today && isViewingTodayMonth}
                className="rounded-md px-2 py-1 text-[10px] font-medium text-cat-deep transition-colors hover:bg-cat-deep/15 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                回到今天
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
