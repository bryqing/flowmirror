/**
 * FlowMirror 核心数据模型
 * 任务：id / title / status / category / scheduled_time /
 *       actual_duration / time_slices / micro_reviews / insights
 */

/**
 * 四大时间板块（内部键 · 持久化标识）
 *
 * ⚠️ 这 4 个键是**存储层标识**：已写入 Supabase `tasks.category` 列，并受
 *    `check (category in ('deep-work','chore','blackhole','rest'))` 约束。
 *    因此键名冻结、永不改动 —— 改动会让线上既有任务全部失去归属。
 *
 * 面向用户与 AI 的词汇统一走 `Quadrant`（q1~q4），二者通过
 * `QUADRANT_TO_CATEGORY` / `CATEGORY_TO_QUADRANT` 互转。
 */
export type TaskCategory = "deep-work" | "chore" | "blackhole" | "rest";

/** 任务状态：待办 / 进行中 / 已完成 / 已冷冻(熔断) */
export type TaskStatus = "pending" | "in-progress" | "done" | "frozen";

/** 时间切片（黑洞溯源的最小单位） */
export interface TimeSlice {
  start: string; // "12:30"
  end: string;   // "13:00"
  label?: string; // "刷短视频"
  /** 是否为失控段（计划外） */
  runaway?: boolean;
}

/** 记忆碎片（微复盘 / 深夜深潜提炼的金句顿悟） */
export interface MemoryFragment {
  text: string;
  source: string; // 来源："深夜认知深潜 · 第三轮" / "微复盘 · 午休黑洞"
}

/** 微复盘（做完即追问的沉淀） */
export interface MicroReview {
  id: string;
  createdAt: string;
  /** 卡点标签 */
  blockerTags: string[];
  /** 经验标签 */
  lessonTags: string[];
  /** 1~2 句快速记录 */
  note: string;
}

/** 任务 */
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  category: TaskCategory;
  /** 计划开始时间 "HH:mm" */
  scheduledTime?: string;
  /** 计划时长（分钟） */
  plannedDuration?: number;
  /** 实际耗时（分钟） */
  actualDuration?: number;
  /** 时间切片 */
  timeSlices: TimeSlice[];
  /** 微复盘记录 */
  microReviews: MicroReview[];
  /** AI 提炼的经验洞察 */
  insights: string[];
  /** 战前锦囊：极简执行 SOP */
  sops: string[];
  /** 历史避坑教训（同类任务沉淀） */
  pitfalls: string[];
  /** 黑洞倒计时（仅 category=blackhole，分钟） */
  blackholeMinutes?: number;
}

/** 昨日之镜 */
export interface DayMirror {
  dateLabel: string;
  completionRate: number; // 0-1
  doneCount: number;
  totalCount: number;
  deepWorkMinutes: number;
  blackholeMinutes: number;
  /** 昨日计划外黑洞切片（失控溯源） */
  blackholeSlices: TimeSlice[];
  /** 黑洞 AI 警示简评 */
  blackholeComment: string;
  /** 记忆碎片（微复盘 + 深夜深潜提炼的金句顿悟） */
  memoryFragments: MemoryFragment[];
  /** 昨晚"最触动我的事"原话片段 */
  mostTouching: string;
  /** 踩坑教训汇总 */
  lessons: { taskTitle: string; text: string }[];
  /** AI 提炼的核心经验卡片 */
  insightCards: { title: string; text: string }[];
  /** 昨晚睡前感悟 */
  bedtimeReflection: string;
  /** 今日晨间计划（对照项） */
  morningPlan: string;
  /** 总体评述 */
  overallComment: string;
}

/** 24 小时时间黑洞热力图 */
export interface HeatmapHour {
  hour: number; // 0-23
  category: TaskCategory | null;
  /** 强度 0-3 */
  intensity: 0 | 1 | 2 | 3;
}

export interface CategoryStat {
  category: TaskCategory;
  totalMinutes: number;
  slices: TimeSlice[];
}

export interface HeatmapData {
  hours: HeatmapHour[];
  stats: CategoryStat[];
}

/** 自然语言命令解析结果 */
export type ParsedCommand =
  | { intent: "add"; title: string; dayLabel: string; time?: string; summary: string }
  | { intent: "reschedule"; keyword: string; dayLabel: string; time?: string; summary: string }
  | { intent: "blackhole"; title: string; minutes: number; summary: string }
  | { intent: "fuse"; summary: string }
  | { intent: "unknown"; summary: string };

/** 灵感 / 思考流（Spark / Thought Stream）：随记闪念，不与执行任务混淆 */
export interface Thought {
  id: string;
  /** 原始想法 */
  content: string;
  /** AI 拓展内容（维度拆解/反思提示/落地建议），未拓展为空串 */
  aiExpansion: string;
  /** 具体时间戳 ISO 字符串 */
  createdAt: string;
  /** 归属日 YYYY-MM-DD，用于按日归档回查 */
  date: string;
  /** 可选标签，供同类灵感串联与即时检索 */
  tags: string[];
  /** 关联的待办任务 id（灵感已转任务时存在，用于展示状态徽标） */
  taskId?: string;
}

/** 晨间心锚（Morning Anchor）：每日一条，由昨日反思 + 今日排布 AI 凝练 */
export interface MorningAnchorEntry {
  id: string;
  /** 归属日 YYYY-MM-DD（本地时区），每日唯一 */
  date: string;
  /** 大字心锚：一行动作断言，AI 凝练 ≤15 字 */
  slogan: string;
  /** 小字注解：点破昨日卡点 + 今日时间锚点（几点前做什么） */
  action: string;
  /** 来源：AI 凝练 / 用户手改 / 种子数据 */
  source: "ai" | "user" | "seed";
  /** 具体时间戳 ISO 字符串 */
  createdAt: string;
}

/* ============================================================
   四象限（Quadrant）—— 对外的统一编号词汇
   ============================================================ */

/**
 * 四象限：面向用户、AI 与接口的**唯一对外标识**。
 * 顺序即看板展示顺序（q1 左上 → q4 右下）。
 */
export type Quadrant = "q1" | "q2" | "q3" | "q4";

/** 任务优先级（AI 拆解建议值，仅作导入排序与提示用） */
export type TaskPriority = "high" | "medium" | "low";

/** AI 拆解产出的一条任务（/api/ai/parse-tasks 的响应元素） */
export interface AiParsedTask {
  title: string;
  quadrant: Quadrant;
  priority: TaskPriority;
}

export const QUADRANT_ORDER: Quadrant[] = ["q1", "q2", "q3", "q4"];

/**
 * 象限定义表：label=显示名，hint=看板上的紧凑提示，definition=给 AI 的完整判据，
 * category=对应的**内部持久化键**。
 *
 * 象限 → 内部键的对应关系（按语义 + 机制双重对齐）：
 *   q1 紧急重要   → deep-work（冰青）核心卡点/限时截止，需高强度专注
 *   q2 日常工作   → chore    （靛蓝）常规主线推进
 *   q3 待执行清单 → rest     （翡翠）暂不紧急的杂项与探索，无特殊机制
 *   q4 休闲娱乐   → blackhole（玫瑰）休息消遣 —— **保留倒计时刹车机制**
 *                    （该机制原本就属于娱乐类活动，归到「待执行清单」会失去意义）
 */
export const QUADRANT_META: Record<
  Quadrant,
  { label: string; hint: string; definition: string; category: TaskCategory }
> = {
  q1: {
    label: "紧急重要",
    hint: "核心卡点 · 紧急解冻 · 限时截止",
    definition: "核心卡点、紧急解冻，以及有硬性截止/今天必须完成、或卡住别人的事项。",
    category: "deep-work",
  },
  q2: {
    label: "日常工作",
    hint: "常规主线 · 产出 · 选题与推进",
    definition: "常规主线工作与产出：日常推进、交付、选题策划与持续推进类任务。",
    category: "chore",
  },
  q3: {
    label: "待执行清单",
    hint: "暂不紧急 · 待抽空处理的杂项与探索",
    definition: "暂不紧急、待后续抽空操作的杂项，以及探索性/尝试性的事项。",
    category: "rest",
  },
  q4: {
    label: "休闲娱乐",
    hint: "休息放松 · 生活调剂 · 娱乐消遣",
    definition: "休息放松、生活调剂与娱乐消遣，例如刷视频、打游戏、散步、冥想、追剧。",
    category: "blackhole",
  },
};

export const QUADRANT_TO_CATEGORY: Record<Quadrant, TaskCategory> = {
  q1: "deep-work",
  q2: "chore",
  q3: "rest",
  q4: "blackhole",
};

export const CATEGORY_TO_QUADRANT: Record<TaskCategory, Quadrant> = {
  "deep-work": "q1",
  chore: "q2",
  rest: "q3",
  blackhole: "q4",
};

/** 象限编号是否合法（AI 返回值校验用） */
export function isQuadrant(value: unknown): value is Quadrant {
  return value === "q1" || value === "q2" || value === "q3" || value === "q4";
}

/** 优先级是否合法 */
export function isTaskPriority(value: unknown): value is TaskPriority {
  return value === "high" || value === "medium" || value === "low";
}

/** 内部键 → 象限编号 */
export function categoryToQuadrant(category: TaskCategory): Quadrant {
  return CATEGORY_TO_QUADRANT[category];
}

/** 象限编号 → 内部键 */
export function quadrantToCategory(quadrant: Quadrant): TaskCategory {
  return QUADRANT_TO_CATEGORY[quadrant];
}

/**
 * 宽容解析 AI 返回的象限字段：接受 q1/1/Q1、以及中文象限名等写法。
 * 无法识别返回 null，由调用方决定兜底。
 */
export function coerceQuadrant(value: unknown): Quadrant | null {
  if (isQuadrant(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = raw.toLowerCase().replace(/^象限/, "").replace(/^q/, "").trim();
  if (n === "1") return "q1";
  if (n === "2") return "q2";
  if (n === "3") return "q3";
  if (n === "4") return "q4";
  const byLabel = QUADRANT_ORDER.find((q) => QUADRANT_META[q].label === raw);
  return byLabel ?? null;
}

/** 优先级显示名与配色（避开玫瑰色，避免与 q4 象限色混淆） */
export const PRIORITY_META: Record<TaskPriority, { label: string; className: string }> = {
  high: { label: "高", className: "border-candle/35 bg-candle/10 text-candle" },
  medium: { label: "中", className: "border-white/15 bg-white/[0.06] text-zinc-300" },
  low: { label: "低", className: "border-white/10 bg-white/[0.03] text-subtle-foreground" },
};

/**
 * 板块视觉元数据：label 已同步为四象限新名称（全局唯一文案来源）。
 * 键顺序 = q1 → q4，热力图图例等按此顺序渲染。
 */
export const CATEGORY_META: Record<
  TaskCategory,
  { label: string; tone: string; text: string; bg: string; border: string; dot: string }
> = {
  "deep-work": {
    label: "紧急重要",
    tone: "text-cat-deep",
    text: "text-cat-deep",
    bg: "bg-cat-deep/10",
    border: "border-cat-deep/25",
    dot: "bg-cat-deep",
  },
  chore: {
    label: "日常工作",
    tone: "text-cat-chore",
    text: "text-cat-chore",
    bg: "bg-cat-chore/10",
    border: "border-cat-chore/25",
    dot: "bg-cat-chore",
  },
  rest: {
    label: "待执行清单",
    tone: "text-cat-rest",
    text: "text-cat-rest",
    bg: "bg-cat-rest/10",
    border: "border-cat-rest/25",
    dot: "bg-cat-rest",
  },
  blackhole: {
    label: "休闲娱乐",
    tone: "text-cat-blackhole",
    text: "text-cat-blackhole",
    bg: "bg-cat-blackhole/10",
    border: "border-cat-blackhole/30",
    dot: "bg-cat-blackhole",
  },
};
