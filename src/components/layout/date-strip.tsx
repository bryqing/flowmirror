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
   * （如「今日时间分布」「昨日之镜」顶部）。默认 false = 战局顶部那个主日期条。
   */
  compact?: boolean;
  /**
   * 锚点前缀，写进 `data-date-row`。
   * 同一页面同时存在多条日期条（战局 / 热力大盘 / 昨日之镜），
   * 靠它区分是哪一个在响应点击。
   */
  dataPrefix?: string;
  /** 是否渲染「回到锚点日」按钮；紧凑模式默认不渲染，空间本就紧张 */
  showTodayButton?: boolean;
  /**
   * 受控的选中日期。不传则读写 context 里的全局 `selectedDate`
   * （战局与热力大盘就是这么共用的）。
   *
   * 「昨日之镜」传它自己的 `mirrorDate`，于是它与战局的日期互不干扰 ——
   * 那两块模块一个看「正在过的一天」，一个看「已经过完的一天」，
   * 强行共用同一个坐标会让语义互相拖拽。
   */
  value?: string;
  /** 受控切换回调，与 `value` 成对使用；不传则写全局 `selectedDate` */
  onChange?: (key: string) => void;
  /**
   * 胶囊窗口相对**真实今天**的起始 / 结束偏移，默认 `-1 ~ 5`（昨天到之后 5 天）。
   * 回顾型板块传 `windowFrom={-6} windowTo={0}`，把窗口整个铺在「今天及之前」。
   */
  windowFrom?: number;
  windowTo?: number;
  /**
   * 晚于此日期的胶囊置灰且不可点。
   * 用于「不能回看未来」的板块 —— 还没过完的日子没有复盘切片可取。
   */
  maxKey?: string;
  /** 「回到锚点日」按钮的文案，默认「回到今天」 */
  resetLabel?: string;
  /** 「回到锚点日」的目标日期，默认全局 `today` */
  resetKey?: string;
  /** 「回到锚点日」的动作，默认全局 `goToday` */
  onReset?: () => void;
}

/**
 * 横向日期胶囊条 —— **全站唯一的日期切换实现**。
 *
 * 三个板块共用它，保证日期窗口、选中态样式、日历入口行为天然一致：
 *   · 战局顶部（`DateStrip`）与热力大盘内部（`compact`）**不传 value**，
 *     于是都读写 context 里同一个 `selectedDate` —— 「在战局选哪天，
 *     切到时间分布就是哪天」是由状态本身保证的，不需要任何同步代码；
 *   · 昨日之镜（`compact` + `value={mirrorDate}`）走**受控模式**，
 *     用它自己的日期坐标，于是「回看某天」不会把战局也一起拽走。
 *
 * - 胶囊条默认以今天为中心（昨天 ~ 未来 5 天），`windowFrom`/`windowTo`
 *   可按板块调整（回顾型板块用 `-6 ~ 0`）；
 * - 选中日期若落在窗口之外（用日历跳到了上个月），会额外补一颗胶囊显示它，
 *   否则用户看不出「当前到底在看哪天」；
 * - `maxKey` 之后的胶囊置灰不可点，供「不能回看未来」的板块使用；
 * - 右侧日历按钮可翻月选择**任意历史/未来日期**。
 */
export function DayCapsules({
  compact = false,
  dataPrefix = "date",
  showTodayButton = !compact,
  value,
  onChange,
  windowFrom = -1,
  windowTo = 5,
  maxKey,
  resetLabel = "回到今天",
  resetKey,
  onReset,
}: DayCapsulesProps) {
  const flow = useFlow();
  // 受控优先：不传 value / onChange 就退回全局 selectedDate（战局与热力大盘共用）
  const activeDate = value ?? flow.selectedDate;
  const commitDate = onChange ?? flow.setSelectedDate;
  const today = flow.today;
  const anchorKey = resetKey ?? today;
  const reset = onReset ?? flow.goToday;

  // 「非今日」相关的区块是客户端专有状态推导出来的（服务端与客户端的「今天」
  // 在跨零点时可能差一天），挂载后再渲染，避免水合不一致。
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // 只有确实不在锚点日上时才给「回退」入口
  const showHistory = mounted && activeDate !== anchorKey;

  const days = useMemo<DayCell[]>(() => {
    const list: DayCell[] = [];
    for (let offset = windowFrom; offset <= windowTo; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      list.push(
        makeCell(toKey(d), today, offset === -1 ? -1 : offset === 0 ? 0 : offset === 1 ? 1 : null)
      );
    }
    return list;
  }, [today, windowFrom, windowTo]);

  // 选中日期不在胶囊窗口内 → 额外渲染一颗，放在窗口的左侧（更早）或右侧（更晚）
  const outsideSelected = !days.some((d) => d.key === activeDate);
  const selectedCell = outsideSelected ? makeCell(activeDate, today) : null;
  // `YYYY-MM-DD` 的字典序即时间序，可直接比较
  const selectedIsEarlier = outsideSelected && activeDate < days[0].key;

  const renderCell = (d: DayCell) => {
    const active = activeDate === d.key;
    // 未来日期置灰：还没过完的一天没有可回顾的内容，点了也只会得到空态
    const blocked = maxKey !== undefined && d.key > maxKey;
    return (
      <button
        key={d.key}
        type="button"
        onClick={blocked ? undefined : () => commitDate(d.key)}
        disabled={blocked}
        aria-label={blocked ? `${d.key}（未来日期）` : `查看 ${d.key}`}
        aria-current={active ? "date" : undefined}
        data-date-cell={d.key}
        data-date-row={dataPrefix}
        data-date-blocked={blocked ? "true" : undefined}
        className={cn(
          "flex shrink-0 flex-col items-center rounded-xl transition-all duration-200",
          compact ? "px-2 py-1" : "px-3 py-1.5",
          blocked
            ? "cursor-not-allowed border border-transparent opacity-30"
            : active
              ? "bg-cat-deep/15 border border-cat-deep/35 shadow-[0_0_18px_-6px_rgba(103,232,249,0.5)]"
              : "border border-transparent hover:bg-slate-100"
        )}
      >
        <span
          className={cn(compact ? "text-[9px]" : "text-[10px]", active ? "text-cat-deep" : "text-subtle-foreground")}
        >
          {/* 昨天 / 今天 / 明天 三个"参照日"直接写中文，其余写星期。
              今天不写成「周X」是刻意的：一眼要能认出"哪颗是今天"，
              圆点只是辅助的微光标记，不能当成唯一的身份线索。 */}
          {d.anchor === -1
            ? "昨天"
            : d.anchor === 0
              ? "今天"
              : d.anchor === 1
                ? "明天"
                : `周${d.weekday}`}
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
    // ⚠️ `min-w-0` 两处都不能省：flex 子项的 `min-width` 默认是 `auto`（= min-content），
    //    一串 8 颗 `shrink-0` 胶囊的最小宽度会把**外层的板块条**一起顶开，
    //    于是本该内部横向滚动的胶囊条变成了整页横向溢出（实测 390px 下 scrollWidth 410）。
    <div className="flex min-w-0 items-center gap-2">
      {/* 紧凑模式省掉左侧「日期」标签：嵌在板块里时空间要留给数据本身 */}
      {!compact && (
        <span className="hidden shrink-0 items-center gap-1.5 pl-1 pr-1 text-[11px] text-subtle-foreground sm:flex">
          <CalendarDays className="size-3.5" />
          日期
        </span>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      {/* 不在锚点日时才出现的回退入口（战局「回到今天」/ 昨日之镜「回到昨日」）
          —— 位置固定在日历按钮左侧，够显眼 */}
      {showTodayButton && showHistory && (
        <button
          type="button"
          onClick={reset}
          aria-label={resetLabel}
          title={resetLabel}
          data-date-reset={dataPrefix}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-cat-deep/35 bg-cat-deep/12 px-2 py-1.5 text-[11px] font-medium text-cat-deep transition-colors hover:bg-cat-deep/20"
        >
          <CornerUpLeft className="size-3.5" />
          <span className="hidden sm:inline">{resetLabel}</span>
        </button>
      )}

      {/* 日历入口：跟着受控/非受控走同一个日期，翻月也能选到窗口外的任意历史日 */}
      <CalendarPopover value={activeDate} onChange={commitDate} today={today} />
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
