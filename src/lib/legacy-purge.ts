/**
 * 历史演示数据清洗（Legacy Seed Purge）
 *
 * ## 为什么需要这个模块
 *
 * 删掉源码里的 `TODAY_TASKS` / `YESTERDAY_MIRROR` 只能阻止**新**的假数据产生，
 * 却管不住**已经写进用户浏览器**的那一份：
 *
 *   · `flowmirror:tasks:snapshot`（旧的无日期键）里躺着旧版初始值 —— 一整套演示任务；
 *   · `flowmirror:tasks:snapshot:<某天>` 里也可能混着它们（旧版 commit 时就存这儿）；
 *   · `flowmirror:tasks:queue` 里可能排着还没补录上去的同一批任务，
 *     一旦恢复联网就会被**正式写进云端**，从「本地脏数据」升级成「云端脏数据」；
 *   · `flowmirror:anchor:snapshot` 里可能存着旧版 AI 失败时的兜底心锚
 *     （`source: "seed"`，例如「不等状态，先动十分钟」），用户从没写过却一直挂着。
 *
 * 于是症状看起来就像"源码里的 mock 又回来了"—— 其实是**缓存死灰复燃**。
 * 本模块只做一件事：在应用启动、任何读取发生之前，把这些历史指纹物理抹掉。
 *
 * ## 边界（很重要）
 *
 * 1. **这是黑名单，不是素材库。** 下面的常量仅用于**识别**要删的旧数据，
 *    永远不会被渲染，也不构成任何形式的"示例兜底"。
 * 2. **只做删除，不做伪造。** 清洗完成后留下的要么是用户真实记录，要么什么都没有。
 * 3. **幂等。** 由 `CACHE_SCHEMA_KEY` 版本号守门，一台设备只跑一次；
 *    重复调用也不会误删（黑名单只认那批固定指纹）。
 * 4. **不碰云端。** 按需求只清洗本地缓存；若云端已存在同名记录，
 *    那是可见的真实数据，交由用户在界面上自行删除，避免按标题匹配误删真人任务。
 */

import {
  BACKLOG_SNAPSHOT_KEY,
  LEGACY_SNAPSHOT_KEY,
  QUEUE_KEY,
  SNAPSHOT_PREFIX,
  localToday,
} from "./offline-store";
import { ANCHOR_SNAPSHOT_KEY } from "./anchor-repository";

/**
 * 缓存结构版本。**改动清洗规则时必须递增**，否则老设备不会重跑。
 * v2 = 移除全部演示任务与预置心锚的第一版清洗。
 * v3 = 追加「心锚文案里塞着历史演示任务名」的清洗
 *      （旧兜底模板 `昨日「${任务名}」还悬着…` 会把假任务名带进心锚，
 *      一条 v2 已放行的旧心锚因此可能继续挂着 —— 必须重跑一次把它扫掉）。
 */
const CACHE_SCHEMA_KEY = "flowmirror:cache-schema";
const CACHE_SCHEMA_VERSION = "3";

/**
 * 旧版演示任务的 id（`task-01` ~ `task-08`）。
 *
 * 真实任务的 id 由 `uid("task")` 生成，形如 `task_a1b2c3d`（**下划线**），
 * 与这里的连字符 + 两位数字不可能相撞，因此按 id 判定是安全且精确的。
 */
const LEGACY_SEED_IDS = new Set([
  "task-01",
  "task-02",
  "task-03",
  "task-04",
  "task-05",
  "task-06",
  "task-07",
  "task-08",
]);

/**
 * 旧版演示任务的标题（标题兜底：万一某条被同步/复制过，id 变了但文案没变）。
 * 逐字照抄自已删除的 `mock-data.ts`，用于识别而非展示。
 */
const LEGACY_SEED_TITLES = new Set([
  "撰写 Q3 产品复盘报告",
  "回复客户邮件 & 审批流程",
  "午休刷短视频",
  "准备周四方案评审：故事线初稿",
  "冥想 15 分钟 + 下楼散步",
  "整理本周报销单",
  "梳理本周工作主线与下周选题",
  "调研竞品新版定价页（探索性尝试）",
]);

/** 旧版预置心锚的特征片段（AI 失败时的写死兜底，用户从未写过） */
const LEGACY_ANCHOR_NEEDLES = [
  "先写烂初稿，再迭代到好",
  "不等状态，先动十分钟",
  "抽不出好开头就先写最烂的第一行",
  "昨日卡点在「完美开场」",
];

export interface PurgeReport {
  /** 本次是否真的执行了清洗（false = 已是最新版本，跳过） */
  ran: boolean;
  /** 被删掉的演示任务条数 */
  removedTasks: number;
  /** 从离线队列里摘掉的演示任务操作数 */
  removedQueueOps: number;
  /** 被删掉的预置心锚条数 */
  removedAnchors: number;
  /** 从旧无日期键迁移到当日键的合法任务数 */
  migratedTasks: number;
  /** 被整体删除的存储键 */
  clearedKeys: string[];
}

const EMPTY_REPORT: PurgeReport = {
  ran: false,
  removedTasks: 0,
  removedQueueOps: 0,
  removedAnchors: 0,
  migratedTasks: 0,
  clearedKeys: [],
};

/** 上一条任务的形状不可信（localStorage 是外部输入），按需取字段 */
interface LooseTask {
  id?: unknown;
  title?: unknown;
  category?: unknown;
}

/** 是否命中历史演示任务指纹 */
function isLegacySeedTask(t: LooseTask | null | undefined): boolean {
  if (!t || typeof t !== "object") return false;
  if (typeof t.id === "string" && LEGACY_SEED_IDS.has(t.id)) return true;
  if (typeof t.title === "string" && LEGACY_SEED_TITLES.has(t.title.trim())) return true;
  return false;
}

/**
 * 标题是否属于历史演示数据。
 *
 * 供**渲染/生成路径**做最后一道防线：本地缓存能靠 `purgeLegacySeedData` 清掉，
 * 但**云端**若曾同步过这批任务，清洗是够不着的（本模块不碰云端）。
 * 于是当晨间心锚要挑"昨天没做完的第一条任务"时，先把这批已知假标题剔掉 ——
 * 宁可少一条素材，也不让一个用户从没建过的任务名出现在心锚文案里。
 */
export function isLegacySeedTitle(title: string): boolean {
  return LEGACY_SEED_TITLES.has(title.trim());
}

/** 读取并解析一个键；非数组一律当作「没有」 */
function readArray(key: string): unknown[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeArray(key: string, list: unknown[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* 存储满 / 隐私模式，静默失败 */
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 枚举所有按日快照的键（`flowmirror:tasks:snapshot:YYYY-MM-DD`） */
function listSnapshotKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      // 必须排除掉旧的无日期键本身：它没有 `:` 后缀，由单独一步处理
      if (k && k.startsWith(`${SNAPSHOT_PREFIX}:`)) keys.push(k);
    }
  } catch {
    /* ignore */
  }
  return keys;
}

/**
 * 执行一次历史演示数据清洗。**必须在任何 `loadSnapshot` 之前调用。**
 *
 * 幂等：版本号已是最新则直接返回 `ran: false`，不做任何遍历。
 */
export function purgeLegacySeedData(): PurgeReport {
  if (typeof window === "undefined") return EMPTY_REPORT;

  // ---- 版本守门：只跑一次 ----
  try {
    if (window.localStorage.getItem(CACHE_SCHEMA_KEY) === CACHE_SCHEMA_VERSION) {
      return EMPTY_REPORT;
    }
  } catch {
    // 读不到版本号（隐私模式）时也继续走一遍清洗，宁多跑不漏跑
  }

  const report: PurgeReport = { ...EMPTY_REPORT, ran: true, clearedKeys: [] };

  // ---- 1. 旧无日期键：合法条目迁到当日键，演示任务丢弃，然后整个键删除 ----
  const legacy = readArray(LEGACY_SNAPSHOT_KEY);
  if (legacy) {
    const kept = legacy.filter((t) => !isLegacySeedTask(t as LooseTask));
    report.removedTasks += legacy.length - kept.length;
    if (kept.length > 0) {
      const todayKey = `${SNAPSHOT_PREFIX}:${localToday()}`;
      // 已是空快照则不迁移，避免凭空造出一个"用户清空过"的语义
      const existing = readArray(todayKey);
      writeArray(todayKey, existing && existing.length > 0 ? existing : kept);
      report.migratedTasks += kept.length;
    }
    removeKey(LEGACY_SNAPSHOT_KEY);
    report.clearedKeys.push(LEGACY_SNAPSHOT_KEY);
  }

  // ---- 2. 每个按日快照：逐条摘掉演示任务 ----
  for (const key of listSnapshotKeys()) {
    const list = readArray(key);
    if (!list) continue;
    const kept = list.filter((t) => !isLegacySeedTask(t as LooseTask));
    const removed = list.length - kept.length;
    if (removed === 0) continue;
    report.removedTasks += removed;
    if (kept.length === 0) {
      // 整份都是演示数据 → 直接删键，而不是留一个空数组
      // （空数组在「待执行池」语义里代表"用户主动清空过"，含义完全不同）
      removeKey(key);
      report.clearedKeys.push(key);
    } else {
      writeArray(key, kept);
    }
  }

  // ---- 3. 待执行清单全局池：同样逐条摘掉 ----
  const backlog = readArray(BACKLOG_SNAPSHOT_KEY);
  if (backlog) {
    const kept = backlog.filter((t) => !isLegacySeedTask(t as LooseTask));
    const removed = backlog.length - kept.length;
    if (removed > 0) {
      report.removedTasks += removed;
      if (kept.length === 0) {
        removeKey(BACKLOG_SNAPSHOT_KEY);
        report.clearedKeys.push(BACKLOG_SNAPSHOT_KEY);
      } else {
        writeArray(BACKLOG_SNAPSHOT_KEY, kept);
      }
    }
  }

  // ---- 4. 离线队列：摘掉指向演示任务的操作 ----
  // 这一步最容易被忽略，却最关键：队列里的 insert 一旦补录成功，
  // 演示任务就会被**正式写进云端**，从此跨设备同步、再也删不干净。
  const queue = readArray(QUEUE_KEY);
  if (queue) {
    const kept = queue.filter((op) => {
      if (!op || typeof op !== "object") return false;
      const o = op as { type?: unknown; task?: LooseTask; id?: unknown };
      if (typeof o.id === "string" && LEGACY_SEED_IDS.has(o.id)) return false;
      if (o.task && isLegacySeedTask(o.task)) return false;
      return true;
    });
    report.removedQueueOps = queue.length - kept.length;
    if (report.removedQueueOps > 0) {
      if (kept.length === 0) {
        removeKey(QUEUE_KEY);
        report.clearedKeys.push(QUEUE_KEY);
      } else {
        writeArray(QUEUE_KEY, kept);
      }
    }
  }

  // ---- 5. 预置心锚：删掉写着兜底文案的那几条 ----
  //
  // 判据有两条，**任一命中即删**：
  //   a) 文案里含旧版写死的兜底句式（如「不等状态，先动十分钟」）；
  //   b) 文案里含任意一个历史演示任务名 —— 旧兜底模板
  //      `昨日「${任务名}」还悬着…` 会把假任务名原样写进心锚，
  //      于是卡片上一直挂着一个用户从没建过的任务。这种心锚同样不是用户写的。
  const anchors = readArray(ANCHOR_SNAPSHOT_KEY);
  if (anchors) {
    const kept = anchors.filter((a) => {
      if (!a || typeof a !== "object") return false;
      const entry = a as { slogan?: unknown; action?: unknown };
      const haystack = `${typeof entry.slogan === "string" ? entry.slogan : ""}${
        typeof entry.action === "string" ? entry.action : ""
      }`;
      if (LEGACY_ANCHOR_NEEDLES.some((needle) => haystack.includes(needle))) return false;
      if (LEGACY_SEED_TITLES.size > 0) {
        for (const title of LEGACY_SEED_TITLES) {
          if (haystack.includes(title)) return false;
        }
      }
      return true;
    });
    report.removedAnchors = anchors.length - kept.length;
    if (report.removedAnchors > 0) {
      if (kept.length === 0) {
        removeKey(ANCHOR_SNAPSHOT_KEY);
        report.clearedKeys.push(ANCHOR_SNAPSHOT_KEY);
      } else {
        writeArray(ANCHOR_SNAPSHOT_KEY, kept);
      }
    }
  }

  // ---- 6. 落版本戳，保证只跑一次 ----
  try {
    window.localStorage.setItem(CACHE_SCHEMA_KEY, CACHE_SCHEMA_VERSION);
  } catch {
    /* ignore */
  }

  return report;
}
