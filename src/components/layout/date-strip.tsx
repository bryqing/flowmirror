"use client";

import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { useFlow } from "@/components/flow-context";
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

/** 横向日期胶囊条：以今天为中心，左含昨日，右展未来 5 天；点击切换全局选中日期 */
export function DateStrip() {
  const { selectedDate, setSelectedDate } = useFlow();

  const days = useMemo<DayCell[]>(() => {
    const list: DayCell[] = [];
    for (let offset = -1; offset <= 5; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      // 用本地时区拼日期 key，与 todayKey() / localDateKey() 保持一致；
      // 绝不能用 toISOString()（UTC），否则在 GMT+8 凌晨会差一天导致筛选错位
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      list.push({
        key: `${d.getFullYear()}-${m}-${day}`,
        weekday: WEEKDAYS[d.getDay()],
        dayNum: d.getDate(),
        month: d.getMonth() + 1,
        anchor: offset === -1 ? -1 : offset === 0 ? 0 : offset === 1 ? 1 : null,
        isToday: offset === 0,
      });
    }
    return list;
  }, []);

  return (
    <div className="glass animate-fade-up flex items-center gap-2 rounded-2xl px-3 py-2.5">
      <span className="hidden shrink-0 items-center gap-1.5 pl-1 pr-1 text-[11px] text-subtle-foreground sm:flex">
        <CalendarDays className="size-3.5" />
        日期
      </span>

      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d) => {
          const active = selectedDate === d.key;
          return (
            <button
              key={d.key}
              onClick={() => setSelectedDate(d.key)}
              className={cn(
                "flex shrink-0 flex-col items-center rounded-xl px-3 py-1.5 transition-all duration-200",
                active
                  ? "bg-cat-deep/15 border border-cat-deep/35 shadow-[0_0_18px_-6px_rgba(103,232,249,0.5)]"
                  : "border border-transparent hover:bg-white/[0.05]"
              )}
            >
              <span
                className={cn(
                  "text-[10px]",
                  active ? "text-cat-deep" : "text-subtle-foreground"
                )}
              >
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
        })}
      </div>

      <span className="hidden shrink-0 pr-1 text-[10px] text-subtle-foreground md:block">
        点击日期回看灵感
      </span>
    </div>
  );
}
