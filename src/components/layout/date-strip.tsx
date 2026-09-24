"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CornerUpLeft } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { CalendarPopover } from "@/components/ui/calendar-popover";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

interface DayCell {
  key: string;
  weekday: string;
  dayNum: number;
  month: number;
  /** -1 昨天 / 0 今天 / 1 明天 / null 普通 */
  anchor: -1 | 0 | 1 | null;
  isToday: boolean;
}

/** `YYYY-MM-DD` → 本地 Date（0 点，避免时区偏移） */
function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 本地时区拼日期 key，与 todayKey() 保持一致；绝不能用 toISOString()（UTC 会差一天） */
function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function makeCell(key: string, today: string, anchor: -1 | 0 | 1 | null = null): DayCell {
  const d = fromKey(key);
  return {
    key,
    weekday: WEEKDAYS[d.getDay()],
    dayNum: d.getDate(),
    month: d.getMonth() + 1,
    anchor,
    isToday: key === today,
  };
}

interface DayCapsulesProps {
  /**
   * 紧凑模式：更小的内边距与字号，用于**嵌在其他板块内部**的日期切换入口
   * （如「今日时间分布」顶部）。默认 false = 战局顶部那个主日期条。
   */
  compact?: boolean;
  /**
   * 锚点前缀，写进 `data-date-row`。
   * 同一页面同时存在两条日期条（战局一条、热力大盘一条），
   * 靠它区分是哪一个在响应点击。
   */
  dataPrefix?: string;
  /** 是否渲染「回到今天」；紧凑模式默认不渲染，空间本就紧张 */
  showTodayButton?: boolean;
}

/**
 * 横向日期胶囊条 —— **全站唯一的日期切换实现**。
 *
 * 战局顶部（`DateStrip`）与热力大盘内部（`compact`）共用它，因此两处的
 * 日期窗口、选中态样式、日历入口行为天然一致；两边都读写 context 里的
 * 同一个 `selectedDate`，所以「在战局选哪天，切到时间分布就是哪天」是
 * 由状态本身保证的，不需要任何额外的同步代码。
 *
 * - 胶囊条以今天为中心（昨天 ~ 未来 5 天），常用日期一点即达；
 * - 选中日期若落在窗口之外（用日历跳到了上个月），会额外补一颗胶囊显示它，
 *   否则用户看不出「当前到底在看哪天」；
 * - 右侧日历按钮可翻月选择**任意历史/未来日期**。
 */
export function DayCapsules({
  compact = false,
  dataPrefix = "date",
  showTodayButton = !compact,
}: DayCapsulesProps) {
  const { selectedDate, setSelectedDate, today, isViewingToday, goToday } = useFlow();

  // 「非今日」相关的区块是客户端专有状态推导出来的（服务端与客户端的「今天」
  // 在跨零点时可能差一天），挂载后再渲染，避免水合不一致。
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const showHistory = mounted && !isViewingToday;

  const days = useMemo<DayCell[]>(() => {
    const list: DayCell[] = [];
    for (let offset = -1; offset <= 5; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      list.push(
        makeCell(toKey(d), today, offset === -1 ? -1 : offset === 0 ? 0 : offset === 1 ? 1 : null)
      );
    }
    return list;
  }, [today]);

  // 选中日期不在胶囊窗口内 → 额外渲染一颗，放在窗口的左侧（更早）或右侧（更晚）
  const outsideSelected = !days.some((d) => d.key === selectedDate);
  const selectedCell = outsideSelected ? makeCell(selectedDate, today) : null;
  // `YYYY-MM-DD` 的字典序即时间序，可直接比较
  const selectedIsEarlier = outsideSelected && selectedDate < days[0].key;

  const renderCell = (d: DayCell) => {
    const active = selectedDate === d.key;
    return (
      <button
        key={d.key}
        onClick={() => setSelectedDate(d.key)}
        aria-label={`查看 ${d.key}`}
        aria-current={active ? "date" : undefined}
        data-date-cell={d.key}
        data-date-row={dataPrefix}
        className={cn(
          "flex shrink-0 flex-col items-center rounded-xl transition-all duration-200",
          compact ? "px-2 py-1" : "px-3 py-1.5",
          active
            ? "bg-cat-deep/15 border border-cat-deep/35 shadow-[0_0_18px_-6px_rgba(103,232,249,0.5)]"
            : "border border-transparent hover:bg-slate-100"
        )}
      >
        <span
          className={cn(compact ? "text-[9px]" : "text-[10px]", active ? "text-cat-deep" : "text-subtle-foreground")}
        >
          {d.anchor === -1 ? "昨天" : d.anchor === 1 ? "明天" : `周${d.weekday}`}
        </span>
        <span
          className={cn(
            "font-mono font-light tabular-nums leading-none",
            compact ? "mt-0.5 text-xs" : "mt-0.5 text-sm",
            active ? "text-foreground" : d.isToday ? "text-foreground/80" : "text-muted-foreground"
          )}
        >
          {d.dayNum}
        </span>
        {d.isToday && (
          <span
            className={cn(
              compact ? "mt-0.5" : "mt-1",
              "size-1 rounded-full",
              active ? "bg-cat-deep" : "bg-cat-deep/50"
            )}
          />
        )}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-2">
      {/* 紧凑模式省掉左侧「日期」标签：嵌在板块里时空间要留给数据本身 */}
      {!compact && (
        <span className="hidden shrink-0 items-center gap-1.5 pl-1 pr-1 text-[11px] text-subtle-foreground sm:flex">
          <CalendarDays className="size-3.5" />
          日期
        </span>
      )}

      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {selectedIsEarlier && selectedCell && (
          <>
            {renderCell(selectedCell)}
            <span className="shrink-0 px-0.5 text-[10px] text-subtle-foreground">…</span>
          </>
        )}

        {days.map(renderCell)}

        {!selectedIsEarlier && selectedCell && (
          <>
            <span className="shrink-0 px-0.5 text-[10px] text-subtle-foreground">…</span>
            {renderCell(selectedCell)}
          </>
        )}
      </div>

      {/* 非今日才出现的「回到今天」—— 位置固定在日历按钮左侧，够显眼 */}
      {showTodayButton && showHistory && (
        <button
          onClick={goToday}
          aria-label="回到今天"
          title="回到今天"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-cat-deep/35 bg-cat-deep/12 px-2 py-1.5 text-[11px] font-medium text-cat-deep transition-colors hover:bg-cat-deep/20"
        >
          <CornerUpLeft className="size-3.5" />
          <span className="hidden sm:inline">回到今天</span>
        </button>
      )}

      <CalendarPopover value={selectedDate} onChange={setSelectedDate} today={today} />
    </div>
  );
}

/**
 * 战局顶部的日期条：胶囊 + 历史回看提示。
 *
 * 注意它挂在 `TodayFlow` 里，也就是**只在「今日战局」板块可见**——
 * 这正是热力大盘需要自己那条 `compact` 日期条的原因：
 * 否则切到时间分布后，用户没有任何切换日期的入口。
 */
export function DateStrip() {
  // 只关心「是不是在看今天」用于渲染回看提示条；日期窗口与切换逻辑都在
  // `DayCapsules` 里（它自己读 today），这里不必再取一次。
  const { selectedDate, isViewingToday } = useFlow();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const showHistory = mounted && !isViewingToday;

  return (
    <div className="glass animate-fade-up flex flex-col gap-2 rounded-2xl px-3 py-2.5">
      <DayCapsules dataPrefix="date" />

      {/* 历史回看提示条：明确告知当前看的是哪一天，避免误把历史当成今天 */}
      {showHistory && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-candle/25 bg-candle/[0.07] px-2.5 py-1.5 text-[11px] text-candle/90">
          <span className="size-1.5 shrink-0 rounded-full bg-candle" />
          正在回看 <span className="font-mono">{selectedDate}</span>
          的战局 · 新增的任务会记在这一天
        </p>
      )}
    </div>
  );
}
