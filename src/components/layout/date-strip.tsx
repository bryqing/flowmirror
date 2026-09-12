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

/**
 * 横向日期胶囊条 + 日历回看入口。
 *
 * - 胶囊条仍以今天为中心（昨天 ~ 未来 5 天），保证常用日期一点即达；
 * - 选中日期若落在窗口之外（用日历跳到了上个月），会额外补一颗胶囊显示它，
 *   否则用户看不出「当前到底在看哪天」；
 * - 右侧的日历按钮可翻月选择**任意历史/未来日期**；
 * - 非今日时给出显眼的历史回看提示与【回到今天】。
 */
export function DateStrip() {
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
        className={cn(
          "flex shrink-0 flex-col items-center rounded-xl px-3 py-1.5 transition-all duration-200",
          active
            ? "bg-cat-deep/15 border border-cat-deep/35 shadow-[0_0_18px_-6px_rgba(103,232,249,0.5)]"
            : "border border-transparent hover:bg-white/[0.05]"
        )}
      >
        <span className={cn("text-[10px]", active ? "text-cat-deep" : "text-subtle-foreground")}>
          {d.anchor === -1 ? "昨天" : d.anchor === 1 ? "明天" : `周${d.weekday}`}
        </span>
        <span
          className={cn(
            "mt-0.5 font-mono text-sm font-light tabular-nums leading-none",
            active ? "text-foreground" : d.isToday ? "text-foreground/80" : "text-muted-foreground"
          )}
        >
          {d.dayNum}
        </span>
        {d.isToday && (
          <span className={cn("mt-1 size-1 rounded-full", active ? "bg-cat-deep" : "bg-cat-deep/50")} />
        )}
      </button>
    );
  };

  return (
    <div className="glass animate-fade-up flex flex-col gap-2 rounded-2xl px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="hidden shrink-0 items-center gap-1.5 pl-1 pr-1 text-[11px] text-subtle-foreground sm:flex">
          <CalendarDays className="size-3.5" />
          日期
        </span>

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
        {showHistory && (
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

      {/* 历史回看提示条：明确告知当前看的是哪一天，避免误把历史当成今天 */}
      {showHistory && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-candle/25 bg-candle/[0.07] px-2.5 py-1.5 text-[11px] text-candle/90">
          <span className="size-1.5 shrink-0 rounded-full bg-candle" />
          正在回看 <span className="font-mono">{selectedDate}</span>
          的任务与灵感 · 新增的内容会记在这一天
        </p>
      )}
    </div>
  );
}
