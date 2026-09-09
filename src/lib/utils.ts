import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 分钟数 → "2小时30分" / "45分" */
export function fmtDuration(minutes: number): string {
  if (minutes <= 0) return "0分";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分`;
}

/** 秒数 → "25:00" */
export function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "13:05" → 当日分钟数 */
export function clockToMinutes(clock?: string): number | null {
  if (!clock) return null;
  const [h, m] = clock.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function uid(prefix = "t"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
