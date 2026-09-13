/**
 * FlowMirror 离线回退层
 * - localStorage 持久化最近一次任务快照（刷新不丢、断网可读）
 * - 待同步操作队列（离线期间的增删改，网络恢复后逐条补录）
 * - 轻量、无依赖，符合「离线优先」设计
 */

import type { Task } from "./types";

const SNAPSHOT_PREFIX = "flowmirror:tasks:snapshot";
const QUEUE_KEY = "flowmirror:tasks:queue";

/**
 * 旧版快照键（无日期维度，只存过「今日」）。
 * 保留仅用于**今日**的回退读取，做一次平滑迁移：一旦今日数据被重新保存，
 * 就会写到带日期的新键上，旧键自然失效。
 */
const LEGACY_SNAPSHOT_KEY = "flowmirror:tasks:snapshot";

/**
 * 「待执行清单」（Q3）全局池的快照键 —— **刻意不按日期分片**。
 *
 * 该池是常驻的、与 selectedDate 无关的全量集合。若把它混进 `snapshot:<date>`：
 *   · 切到任意一天回看，池子会被那天的数据覆盖（条目「凭空消失」）；
 *   · 反过来在池子里增删，也会把某一天的历史快照写脏。
 * 所以它必须自带一个稳定键，和按日快照完全隔离。
 */
const BACKLOG_SNAPSHOT_KEY = "flowmirror:tasks:backlog";

/** 本地时区的今天（YYYY-MM-DD）。不能 import todayKey：那会引入 supabase 依赖链 */
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function snapshotKey(dateKey: string): string {
  return `${SNAPSHOT_PREFIX}:${dateKey}`;
}

export type PendingOp =
  | { type: "insert"; task: Task; dateKey: string; clientId: string }
  | { type: "update"; task: Task; clientId: string }
  | { type: "delete"; id: string; clientId: string };

function safeGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存储满 / 隐私模式，静默失败 */
  }
}

/**
 * 保存任务快照（乐观更新时同步写，作为离线兜底）。
 *
 * ⚠️ 必须按日期分键：看板可以查看任意历史日期，若共用一个键，
 * 回看历史时的一次编辑就会把「今日」的离线快照覆盖成那天的数据 ——
 * 表现是回到今天后发现今天的任务变了。
 */
export function saveSnapshot(tasks: Task[], dateKey: string): void {
  safeSet(snapshotKey(dateKey), tasks);
}

/**
 * 补齐本地快照里可能缺失的数组字段。
 *
 * localStorage 是**不可信输入**：旧版本写的快照、手工改过的数据、跨版本升级遗留的
 * 记录，都可能缺 `timeSlices` / `microReviews` 等字段。这些字段在类型上是必填的，
 * 渲染层会直接 `.some` / `.length`（见 task-time 的 isTiming / deriveHeatmap、卡片上的
 * microReviews.length）—— 只要有一条缺失，渲染时就抛错，React 会把**整个应用**
 * 卸载成白屏（实测：仅 1 条缺 timeSlices 的待办就足以让全站消失）。
 *
 * 远端路径已由 `rowToTask` 兜底（全部 `?? []`），这里把本地路径补齐，两侧口径一致。
 */
function normalizeTask(t: Task): Task {
  return {
    ...t,
    timeSlices: t.timeSlices ?? [],
    microReviews: t.microReviews ?? [],
    insights: t.insights ?? [],
    sops: t.sops ?? [],
    pitfalls: t.pitfalls ?? [],
  };
}

/** 快照数组归一化：非数组（脏数据）一律当作「没有快照」 */
function normalizeTasks(list: unknown): Task[] | null {
  if (!Array.isArray(list)) return null;
  return (list as Task[]).map(normalizeTask);
}

/** 读取指定日期的任务快照（今日可回退到旧版无日期键） */
export function loadSnapshot(dateKey: string): Task[] | null {
  const scoped = normalizeTasks(safeGet<Task[]>(snapshotKey(dateKey)));
  if (scoped) return scoped;
  if (dateKey === localToday()) return normalizeTasks(safeGet<Task[]>(LEGACY_SNAPSHOT_KEY));
  return null;
}

/** 清空某日快照 */
export function clearSnapshot(dateKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(snapshotKey(dateKey));
    if (dateKey === localToday()) window.localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

/** 读取「待执行清单」全局池快照（不存在返回 null；空数组是有效值，代表「池子已清空」） */
export function loadBacklogSnapshot(): Task[] | null {
  return normalizeTasks(safeGet<Task[]>(BACKLOG_SNAPSHOT_KEY));
}

/** 保存「待执行清单」全局池快照 */
export function saveBacklogSnapshot(tasks: Task[]): void {
  safeSet(BACKLOG_SNAPSHOT_KEY, tasks);
}

/** 读取待同步队列 */
export function loadQueue(): PendingOp[] {
  return safeGet<PendingOp[]>(QUEUE_KEY) ?? [];
}

/** 入队一个待同步操作 */
export function enqueue(op: PendingOp): void {
  const q = loadQueue();
  // 同 clientId 去重（同一逻辑操作重复入队时保留最新）
  const filtered = q.filter((item) => item.clientId !== op.clientId);
  filtered.push(op);
  safeSet(QUEUE_KEY, filtered);
}

/** 出队（删除指定 clientId 的操作） */
export function dequeue(clientId: string): void {
  const q = loadQueue().filter((item) => item.clientId !== clientId);
  safeSet(QUEUE_KEY, q);
}

/** 清空队列 */
export function clearQueue(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}
