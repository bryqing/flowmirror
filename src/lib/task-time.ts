/**
 * FlowMirror 时间轴计算层（纯函数）
 *
 * 这一层的唯一职责：把「任务」翻译成「一天里的时间占用」。
 * 热力大盘（24 小时分布）、昨日之镜（完成率/各板块时长）都只依赖这里的派生结果，
 * 不各自维护一套口径 —— 否则同一个任务在两张图上会算出不同的时长。
 *
 * 口径（唯一且必须一致）：
 *   1. 有**已记录的时间切片**（`timeSlices` 且 start/end 都齐全）→ 用切片的起止跨度，
 *      这是用户真实干过的时段，优先级最高。
 *   2. 否则退化为「计划时间 + 时长」：`scheduledTime` 加上
 *      `actualDuration ?? plannedDuration`。
 *   3. 两者都没有 → 该任务不产生任何时间占用（返回 null），如实不画。
 *
 * ⚠️ 切片跨度取 `min(start)` ~ `max(end)`，中间的空档不扣除 —— 一个任务在
 * 09:30 开始、10:30 结束就是占用了这一小时，中间是否喝水不重要，热力图的语义是
 * 「这段时间被这件事占着」，不是「净工作时长」。
 */

import {
  QUADRANT_META,
  QUADRANT_ORDER,
  type HeatmapData,
  type HeatmapHour,
  type Task,
  type TaskCategory,
  type TimeSlice,
} from "./types";
import { clockToMinutes } from "./utils";

/** 一天的总分钟数 */
const DAY_MINUTES = 24 * 60;

/** 四大板块的固定展示顺序（q1 → q4），热力图图例与统计块都按它渲染 */
export const CATEGORY_ORDER: TaskCategory[] = QUADRANT_ORDER.map(
  (q) => QUADRANT_META[q].category
);

/** 分钟数 → "HH:mm"（超过 24h 回绕，避免出现 "25:10" 这种非法时钟） */
export function minutesToClock(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 当前时刻 "HH:mm"（本地时区） */
export function nowClock(): string {
  return minutesToClock(new Date().getHours() * 60 + new Date().getMinutes());
}

/** 解析 "HH:mm" → 当日分钟数（宽松：非法值返回 null，由 clockToMinutes 统一处理） */
export function toMinutes(clock?: string): number | null {
  const n = clockToMinutes(clock);
  if (n === null || n < 0 || n >= DAY_MINUTES) return null;
  return n;
}

/** 某个切片是否为「正在进行中」（有开始时间、还没结束） */
export function isOpenSlice(slice: TimeSlice): boolean {
  return Boolean(slice.start) && !slice.end;
}

/** 该任务当前是否正在计时 */
export function isTiming(task: Task): boolean {
  return task.timeSlices.some(isOpenSlice);
}

/** 正在计时的那个切片的开始时刻（未计时返回 null） */
export function openSliceStart(task: Task): string | null {
  return task.timeSlices.find(isOpenSlice)?.start ?? null;
}

/**
 * 累加切片时长（分钟）。
 * 只统计已闭合（start + end 都在）的切片；跨零点的切片按当日剩余时间截断。
 */
export function sumSliceMinutes(slices: TimeSlice[]): number {
  let total = 0;
  for (const s of slices) {
    const start = toMinutes(s.start);
    const end = toMinutes(s.end);
    if (start === null || end === null) continue;
    if (end > start) total += end - start;
  }
  return total;
}

/** 已完成切片累计时长（用于「已记录 X 分钟」） */
export function recordedMinutes(task: Task): number {
  return task.actualDuration ?? sumSliceMinutes(task.timeSlices);
}

/** 任务的时间窗口（当日分钟数） */
export interface TaskWindow {
  start: number;
  end: number;
  /** 该窗口是否来自真实记录的切片（false = 只是计划） */
  fromSlices: boolean;
}

/**
 * 计算任务在一天里占用的时间窗口。返回 null 表示这个任务没有可用时间信息，
 * 不应出现在热力图上（**不猜、不补默认值**）。
 */
export function taskWindow(task: Task): TaskWindow | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const slice of task.timeSlices) {
    const a = toMinutes(slice.start);
    const b = toMinutes(slice.end);
    if (a !== null) starts.push(a);
    if (b !== null) ends.push(b);
  }
  if (starts.length > 0 && ends.length > 0) {
    const start = Math.min(...starts);
    const end = Math.max(...ends);
    if (end > start) return { start, end: Math.min(end, DAY_MINUTES), fromSlices: true };
  }

  const start = toMinutes(task.scheduledTime);
  if (start === null) return null;
  const duration = task.actualDuration ?? task.plannedDuration ?? 0;
  if (duration <= 0) return { start, end: start, fromSlices: false };
  return { start, end: Math.min(DAY_MINUTES, start + duration), fromSlices: false };
}

/** 窗口时长（分钟） */
export function windowMinutes(task: Task): number {
  const w = taskWindow(task);
  return w ? Math.max(0, w.end - w.start) : 0;
}

/** 卡片上的时间段文案："09:30–11:00" / "09:30" / null（没有时间信息） */
export function windowLabel(task: Task): string | null {
  const w = taskWindow(task);
  if (!w) return null;
  if (w.end <= w.start) return minutesToClock(w.start);
  return `${minutesToClock(w.start)}–${minutesToClock(w.end)}`;
}

/**
 * 某任务的「有效时长」——用于昨日之镜 / 热力图图例的板块累计。
 *
 * 顺序：真实计时记录 → 实际时长字段 → 计划时长 → 窗口跨度。
 * **必须与热力图同口径**：热力图画的是真实占用（切片），
 * 若板块累计却用计划时长，同一个任务在色带与明细里会给出两个数字，
 * 用户一眼就能看出对不上（例如计划 90 分钟但只记了 45 分钟）。
 */
export function effectiveMinutes(task: Task): number {
  const recorded = sumSliceMinutes(task.timeSlices);
  if (recorded > 0) return recorded;
  if (task.actualDuration && task.actualDuration > 0) return task.actualDuration;
  if (task.plannedDuration && task.plannedDuration > 0) return task.plannedDuration;
  return windowMinutes(task);
}

/* ============================================================
   热力大盘派生
   ============================================================ */

/**
 * 由当前视图的任务列表派生 24 小时热力分布。
 *
 * 每个小时格取「在该小时内占用分钟数最多」的板块作为主色；
 * 强度按该板块在该小时的覆盖率分档（≥90% → 3，≥50% → 2，其余 → 1）。
 * 同一小时内多板块混排时只看主色 —— 24 格横向排布，再细分也看不出层次，
 * 具体明细交给下方的四大板块切片列表。
 */
export function deriveHeatmap(tasks: Task[]): HeatmapData {
  /** hour → { category → minutes } */
  const buckets: Partial<Record<TaskCategory, number>>[] = Array.from(
    { length: 24 },
    () => ({})
  );
  const stats = new Map<TaskCategory, { totalMinutes: number; slices: TimeSlice[] }>();

  for (const task of tasks) {
    const w = taskWindow(task);
    if (!w || w.end <= w.start) continue;
    const minutes = w.end - w.start;

    // 逐小时累积占用（跨小时的任务会被切分到每个小时桶里）
    const firstHour = Math.floor(w.start / 60);
    const lastHour = Math.min(23, Math.floor((w.end - 1) / 60));
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      const from = Math.max(hour * 60, w.start);
      const to = Math.min((hour + 1) * 60, w.end);
      const spent = to - from;
      if (spent <= 0) continue;
      const bucket = buckets[hour];
      bucket[task.category] = (bucket[task.category] ?? 0) + spent;
    }

    // 板块累计与切片明细
    const entry = stats.get(task.category) ?? { totalMinutes: 0, slices: [] };
    entry.totalMinutes += minutes;
    entry.slices.push({
      start: minutesToClock(w.start),
      end: minutesToClock(w.end),
      label: task.title,
      // 实际超出计划即为失控段（黑洞溯源用）
      runaway:
        task.category === "blackhole" &&
        Boolean(task.plannedDuration) &&
        minutes > (task.plannedDuration ?? 0),
    });
    stats.set(task.category, entry);
  }

  const hours: HeatmapHour[] = buckets.map((bucket, hour) => {
    const entries = Object.entries(bucket) as [TaskCategory, number][];
    if (entries.length === 0) return { hour, category: null, intensity: 0 };
    const [category, minutes] = entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    const ratio = Math.min(1, minutes / 60);
    const intensity: HeatmapHour["intensity"] = ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : 1;
    return { hour, category, intensity };
  });

  return {
    hours,
    stats: CATEGORY_ORDER.map((category) => {
      const entry = stats.get(category);
      return {
        category,
        totalMinutes: entry?.totalMinutes ?? 0,
        slices: (entry?.slices ?? []).sort((a, b) => a.start.localeCompare(b.start)),
      };
    }),
  };
}

/** 该日是否有任何可用时间信息（用于热力图空态判定） */
export function hasTimeData(tasks: Task[]): boolean {
  return tasks.some((t) => {
    const w = taskWindow(t);
    return Boolean(w && w.end > w.start);
  });
}

/**
 * 黑洞失控警告文案。全部由真实切片拼出，没有任何硬编码描述；
 * 没有失控段时返回 null（不硬凑一句"今日一切正常"来占位）。
 */
export function blackholeWarning(data: HeatmapData): string | null {
  const blackhole = data.stats.find((s) => s.category === "blackhole");
  if (!blackhole || blackhole.totalMinutes === 0) return null;
  const runaway = blackhole.slices.filter((s) => s.runaway);
  if (runaway.length === 0) return null;
  const runawayMinutes = runaway.reduce(
    (sum, s) => sum + Math.max(0, (toMinutes(s.end) ?? 0) - (toMinutes(s.start) ?? 0)),
    0
  );
  const detail = runaway.map((s) => `${s.start}–${s.end} ${s.label}`).join("、");
  const share = Math.round((runawayMinutes / blackhole.totalMinutes) * 100);
  return `黑洞切片警告：失控段 ${runaway.length} 段、共 ${runawayMinutes} 分钟，占本日娱乐总时长 ${share}%。明细 —— ${detail}。下次给这类活动先设倒计时再开始。`;
}

/* ============================================================
   日期工具（一律本地时区，禁止 toISOString —— UTC 会在 GMT+8 凌晨算差一天）
   ============================================================ */

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 今天的日期 key（本地时区） */
export function localDateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 日期 key 加减天数（跨月/跨年交给 Date 处理） */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + deltaDays);
  return localDateKey(date);
}

/** "2026-09-11" → "9月11日 · 周五"（昨日之镜的日期标签） */
export function fmtDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`;
}
