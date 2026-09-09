/**
 * FlowMirror 核心数据模型
 * 任务：id / title / status / category / scheduled_time /
 *       actual_duration / time_slices / micro_reviews / insights
 */

/** 四大时间板块 */
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
  /** 可选标签，供未来同类灵感串联 */
  tags: string[];
}

export const CATEGORY_META: Record<
  TaskCategory,
  { label: string; tone: string; text: string; bg: string; border: string; dot: string }
> = {
  "deep-work": {
    label: "深度工作",
    tone: "text-cat-deep",
    text: "text-cat-deep",
    bg: "bg-cat-deep/10",
    border: "border-cat-deep/25",
    dot: "bg-cat-deep",
  },
  chore: {
    label: "日常杂务",
    tone: "text-cat-chore",
    text: "text-cat-chore",
    bg: "bg-cat-chore/10",
    border: "border-cat-chore/25",
    dot: "bg-cat-chore",
  },
  blackhole: {
    label: "娱乐黑洞",
    tone: "text-cat-blackhole",
    text: "text-cat-blackhole",
    bg: "bg-cat-blackhole/10",
    border: "border-cat-blackhole/30",
    dot: "bg-cat-blackhole",
  },
  rest: {
    label: "休息恢复",
    tone: "text-cat-rest",
    text: "text-cat-rest",
    bg: "bg-cat-rest/10",
    border: "border-cat-rest/25",
    dot: "bg-cat-rest",
  },
};
