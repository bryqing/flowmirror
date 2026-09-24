/**
 * FlowMirror 离线回退层
 * - localStorage 持久化最近一次任务快照（刷新不丢、断网可读）
 * - 待同步操作队列（离线期间的增删改，网络恢复后逐条补录）
 * - 轻量、无依赖，符合「离线优先」设计
 */

import { coerceTaskCategory, coerceTaskStatus, type Task } from "./types";

/**
 * 按日快照的键前缀（完整键 = `${SNAPSHOT_PREFIX}:${YYYY-MM-DD}`）。
 *
 * 导出是为了让 `legacy-purge` 能枚举所有日期的快照做一次历史清洗 ——
 * 键名只能有这一个定义处，别的地方硬编码字符串必然写漂。
 */
export const SNAPSHOT_PREFIX = "flowmirror:tasks:snapshot";
export const QUEUE_KEY = "flowmirror:tasks:queue";

/**
 * 旧版快照键（无日期维度，只存过「今日」）。
 *
 * ⚠️ **已彻底停止读取** —— 这里保留常量只为让 `legacy-purge` 能把它删掉。
 *
 * 早先版本用它做「今日」的回退读取，看起来是个无痛的平滑迁移，实际是个长期毒源：
 * 那个键里躺着的正是旧版写下的 `TODAY_TASKS` 演示任务，且**永远不会自然失效** ——
 * 只要用户当天没产生新快照（新装、清缓存、跨天、换设备），
 * `loadSnapshot(今天)` 就会把它捞出来，于是「今天」又凭空长出一整天的假任务，
 * 看起来就像"代码里的 mock 又回来了"。历史演示数据的唯一归宿是删除，不是回退。
 */
export const LEGACY_SNAPSHOT_KEY = "flowmirror:tasks:snapshot";

/**
 * 「待执行清单」（Q3）全局池的快照键 —— **刻意不按日期分片**。
 *
 * 该池是常驻的、与 selectedDate 无关的全量集合。若把它混进 `snapshot:<date>`：
 *   · 切到任意一天回看，池子会被那天的数据覆盖（条目「凭空消失」）；
 *   · 反过来在池子里增删，也会把某一天的历史快照写脏。
 * 所以它必须自带一个稳定键，和按日快照完全隔离。
 */
export const BACKLOG_SNAPSHOT_KEY = "flowmirror:tasks:backlog";

/**
 * 本地时区的今天（YYYY-MM-DD）。不能 import todayKey：那会引入 supabase 依赖链。
 * 导出供 `legacy-purge` 决定旧无日期快照要迁移到哪一天。
 */
export function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function snapshotKey(dateKey: string): string {
  return `${SNAPSHOT_PREFIX}:${dateKey}`;
}

/**
 * 一条待补录操作。
 *
 * `attempts` / `lastError` 存在的唯一理由是**让队列能自我了断**。
 * 没有它们时，一条永远不可能成功的操作（例如更新一条已被别端删除的行、
 * 或触发数据库约束报错）会永久留在队列里 —— 而队列非空是
 * 「暂停轮询以免覆盖本地改动」的判据，于是**一次性的坏操作会把多端同步永久堵死**，
 * 表现为「手机上明明改了，电脑端再也不同步了」。
 */
export type PendingOp = (
  | { type: "insert"; task: Task; dateKey: string }
  | { type: "update"; task: Task }
  | { type: "delete"; id: string }
) & {
  clientId: string;
  attempts?: number;
  lastError?: string;
};

/** 同一条操作连续失败到这个次数后放弃（不再阻塞后续同步） */
export const MAX_ATTEMPTS = 5;

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
 * 补齐本地快照里可能缺失的数组字段，并校验两个枚举字段。
 *
 * localStorage 是**不可信输入**：旧版本写的快照、手工改过的数据、跨版本升级遗留的
 * 记录，都可能缺 `timeSlices` / `microReviews` 等字段。这些字段在类型上是必填的，
 * 渲染层会直接 `.some` / `.length`（见 task-time 的 isTiming / deriveHeatmap、卡片上的
 * microReviews.length）—— 只要有一条缺失，渲染时就抛错，React 会把**整个应用**
 * 卸载成白屏（实测：仅 1 条缺 timeSlices 的待办就足以让全站消失）。
 *
 * 远端路径已由 `rowToTask` 兜底（全部 `?? []`），这里把本地路径补齐，两侧口径一致。
 *
 * ⚠️ `status` / `category` 也要一起校验：它们会拿去查 `STATUS_META` /
 * `CATEGORY_META`，读到陌生值时查表返回 undefined，紧接着的 `.dot` / `.className`
 * 就是同一个白屏。数组字段与枚举字段缺一不可。
 */
export function normalizeTask(t: Task): Task {
  return {
    ...t,
    status: coerceTaskStatus(t?.status),
    category: coerceTaskCategory(t?.category),
    timeSlices: t?.timeSlices ?? [],
    microReviews: t?.microReviews ?? [],
    insights: t?.insights ?? [],
    sops: t?.sops ?? [],
    pitfalls: t?.pitfalls ?? [],
  };
}

/** 快照数组归一化：非数组（脏数据）一律当作「没有快照」 */
function normalizeTasks(list: unknown): Task[] | null {
  if (!Array.isArray(list)) return null;
  return list.filter((t): t is Task => Boolean(t) && typeof t === "object").map(normalizeTask);
}

/**
 * 读取指定日期的任务快照：**只认带日期的那一个键**。
 *
 * 刻意不再回退到无日期的 `LEGACY_SNAPSHOT_KEY`（见上方常量处的说明）。
 * 那个回退是「旧演示任务死灰复燃」的唯一通道 —— 没有任何快照时，正确的答案是
 * 「这一天没有记录」，而不是去翻一个装着 `TODAY_TASKS` 的旧箱子。
 * 旧键里万一还有真实数据，由 `legacy-purge` 在启动时先迁移到当日键再删除。
 */
export function loadSnapshot(dateKey: string): Task[] | null {
  return normalizeTasks(safeGet<Task[]>(snapshotKey(dateKey)));
}

/** 清空某日快照 */
export function clearSnapshot(dateKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(snapshotKey(dateKey));
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
  const q = safeGet<PendingOp[]>(QUEUE_KEY);
  return Array.isArray(q) ? q.filter((op) => op && typeof op.clientId === "string") : [];
}

/**
 * 入队一个待同步操作。
 *
 * 同 clientId 去重并**重置 attempts**：能走到这里说明是用户的又一次明确意图
 * （例如改了象限后重写那笔 insert），理应重新获得完整的重试预算。
 */
export function enqueue(op: PendingOp): void {
  const q = loadQueue();
  const filtered = q.filter((item) => item.clientId !== op.clientId);
  filtered.push({ ...op, attempts: 0, lastError: undefined });
  safeSet(QUEUE_KEY, filtered);
}

/** 出队（删除指定 clientId 的操作） */
export function dequeue(clientId: string): void {
  const q = loadQueue().filter((item) => item.clientId !== clientId);
  safeSet(QUEUE_KEY, q);
}

/**
 * 记一次失败：累加尝试次数并保留最后一次错误信息（便于排查）。
 * 返回累加后的次数，调用方据此决定是否放弃这条操作。
 */
export function bumpAttempt(clientId: string, error: string): number {
  const q = loadQueue();
  let count = 0;
  const next = q.map((op) => {
    if (op.clientId !== clientId) return op;
    count = (op.attempts ?? 0) + 1;
    return { ...op, attempts: count, lastError: error };
  });
  safeSet(QUEUE_KEY, next);
  return count;
}

/** 队列里是否还有「尚未推上去的新增」。新增没推上去时，云端那份列表天然缺它 */
export function hasPendingInserts(): boolean {
  return loadQueue().some((op) => op.type === "insert");
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
