/**
 * FlowMirror 离线回退层
 * - localStorage 持久化最近一次任务快照（刷新不丢、断网可读）
 * - 待同步操作队列（离线期间的增删改，网络恢复后逐条补录）
 * - 轻量、无依赖，符合「离线优先」设计
 */

import type { Task } from "./types";

const SNAPSHOT_KEY = "flowmirror:tasks:snapshot";
const QUEUE_KEY = "flowmirror:tasks:queue";

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

/** 保存任务快照（乐观更新时同步写，作为离线兜底） */
export function saveSnapshot(tasks: Task[]): void {
  safeSet(SNAPSHOT_KEY, tasks);
}

/** 读取最近一次任务快照 */
export function loadSnapshot(): Task[] | null {
  return safeGet<Task[]>(SNAPSHOT_KEY);
}

/** 清空快照 */
export function clearSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY);
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
