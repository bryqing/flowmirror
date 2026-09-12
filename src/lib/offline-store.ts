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

/** 读取指定日期的任务快照（今日可回退到旧版无日期键） */
export function loadSnapshot(dateKey: string): Task[] | null {
  const scoped = safeGet<Task[]>(snapshotKey(dateKey));
  if (scoped) return scoped;
  if (dateKey === localToday()) return safeGet<Task[]>(LEGACY_SNAPSHOT_KEY);
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
