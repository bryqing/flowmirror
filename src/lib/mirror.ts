/**
 * FlowMirror 昨日之镜 · 真实指标计算
 *
 * 设计原则：**一切内容都必须可追溯到用户自己的录入，一条都不许编。**
 *
 * 昨日之镜里的每一项都来自前一天的真实数据，没有任何预置文案：
 *
 *   A. 可计算指标 —— 完成率、完成/总数、各板块时长、黑洞切片、踩坑教训。
 *      直接从前一天的真实任务记录算出来（本文件负责）。完成率是用户唯一会
 *      盯着看的数字，编一个 71% 毫无意义。
 *
 *   B. 叙事 —— 记忆碎片、认知金句、最触动的事、睡前感悟、今晨计划、经验卡。
 *      产自「微复盘 + 深夜深潜」，由 `mirror_snapshots` 落库后回填。
 *      **在落库链路接入之前，这里一律为空** —— 早先版本用一份写死的示例叙事
 *      填充（"外界的挑剔，只是内心心虚的放大镜"等），结果是用户在没做任何复盘
 *      的情况下也看到一整屏"自己的感悟"，分不清哪些是真实沉淀，
 *      这比空着更糟：空态是诚实的信息，假叙事是误导。
 *
 * 前一天一条任务都没有时不会伪造任何东西：`isReal` 返回 false，
 * 各字段全为空值/空数组，调用方据此渲染纯净空态。
 */

import type { DayMirror, Task, TimeSlice } from "./types";
import { fmtDateLabel, taskWindow, effectiveMinutes, minutesToClock } from "./task-time";
import { fmtDuration } from "./utils";

export interface DayMirrorResult {
  mirror: DayMirror;
  /**
   * true  = 前一天有真实任务记录，指标由它们算出
   * false = 前一天无任何记录，全部字段为空值（不是"示例"，是"没有"）
   */
  isReal: boolean;
}

/** 空镜像：前一天没有任何记录时使用。全部零值 / 空数组，无任何占位文案。 */
const EMPTY_MIRROR: Omit<DayMirror, "dateLabel"> = {
  completionRate: 0,
  doneCount: 0,
  totalCount: 0,
  deepWorkMinutes: 0,
  blackholeMinutes: 0,
  blackholeSlices: [],
  blackholeComment: "",
  memoryFragments: [],
  mostTouching: "",
  lessons: [],
  insightCards: [],
  bedtimeReflection: "",
  morningPlan: "",
  overallComment: "",
};

/** 汇总某一板块的当日总时长（分钟）：真实记录优先，其次计划时长 */
function categoryMinutes(tasks: Task[], category: Task["category"]): number {
  return (tasks ?? [])
    .filter((t) => t.category === category)
    .reduce((sum, t) => sum + effectiveMinutes(t), 0);
}

/** 由真实任务派生黑洞切片（含失控判定：实际跨度超出计划时长即为失控段） */
function blackholeSlicesOf(tasks: Task[]): TimeSlice[] {
  return (tasks ?? [])
    .filter((t) => t.category === "blackhole")
    .map((task) => {
      const w = taskWindow(task);
      if (!w) return null;
      const minutes = Math.max(0, w.end - w.start);
      const planned = task.plannedDuration ?? task.blackholeMinutes ?? 0;
      const slice: TimeSlice = {
        start: minutesToClock(w.start),
        end: minutesToClock(w.end),
        label: String(task.title ?? ""),
        runaway: planned > 0 && minutes > planned,
      };
      return slice;
    })
    .filter((s): s is TimeSlice => s !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 由真实微复盘派生「踩坑教训」（有卡点或笔记的才算一条）。
 *
 * `microReviews` 与 `note` 都来自外部存储，运行时**不保证存在**：
 * 一条跨版本遗留的记录缺这个字段，`for...of` 就会在渲染期抛错并卸载整棵树。
 */
function lessonsOf(tasks: Task[]): { taskTitle: string; text: string }[] {
  const lessons: { taskTitle: string; text: string }[] = [];
  for (const task of tasks ?? []) {
    for (const review of task.microReviews ?? []) {
      const text = String(review?.note ?? "").trim();
      if (!text) continue;
      lessons.push({ taskTitle: String(task.title ?? ""), text });
    }
  }
  return lessons;
}

/** 由真实黑洞切片拼出警示文案（没有失控段就不硬凑一句占位） */
function blackholeCommentOf(slices: TimeSlice[], totalMinutes: number): string {
  if (totalMinutes <= 0) return "";
  const runaway = slices.filter((s) => s.runaway);
  if (runaway.length === 0) {
    return `昨日休闲娱乐共 ${fmtDuration(totalMinutes)}，均为计划内，没有出现失控段。节制本身就是一种恢复力。`;
  }
  const runawayMinutes = runaway.reduce((sum, s) => {
    const [sh, sm] = s.start.split(":").map(Number);
    const [eh, em] = s.end.split(":").map(Number);
    return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm));
  }, 0);
  const share = Math.round((runawayMinutes / totalMinutes) * 100);
  const latest = runaway[runaway.length - 1];
  return `失控 ${runaway.length} 段、共 ${runawayMinutes} 分钟，占昨日娱乐 ${share}%。最近一段是 ${latest.start}–${latest.end}「${latest.label}」。给快乐装上刹车：开始前先设倒计时。`;
}

/**
 * 计算昨日之镜。
 *
 * @param tasks    前一天的**真实任务列表**（空数组 = 那天没有任何记录）
 * @param dateKey  前一天日期 key "YYYY-MM-DD"
 *
 * 无记录时返回全空镜像（`isReal: false`）—— 调用方据此渲染空态，
 * 绝不填充任何预置叙事。
 */
export function buildDayMirror(tasks: Task[], dateKey: string): DayMirrorResult {
  const dateLabel = fmtDateLabel(dateKey);
  // 唯一归一化点：后面全部走这个局部变量，不在每个分支各写一遍 ?? []
  const list = Array.isArray(tasks) ? tasks : [];
  const isReal = list.length > 0;

  // 无记录：干净的零值，没有可回退的"示例"
  if (!isReal) {
    return { mirror: { ...EMPTY_MIRROR, dateLabel }, isReal: false };
  }

  const totalCount = list.length;
  const doneCount = list.filter((t) => t.status === "done").length;
  const completionRate = totalCount > 0 ? doneCount / totalCount : 0;
  const deepWorkMinutes = categoryMinutes(list, "deep-work");
  const blackholeMinutes = categoryMinutes(list, "blackhole");
  const blackholeSlices = blackholeSlicesOf(list);
  const lessons = lessonsOf(list);

  /** 与数字自洽的总体评述 */
  const parts = [`完成率 ${Math.round(completionRate * 100)}%，${doneCount}/${totalCount} 项完成`];
  if (deepWorkMinutes > 0) parts.push(`紧急重要 ${fmtDuration(deepWorkMinutes)}`);
  if (blackholeMinutes > 0) parts.push(`休闲娱乐 ${fmtDuration(blackholeMinutes)}`);
  const unfinished = list.filter((t) => t.status === "pending" || t.status === "in-progress").length;
  if (unfinished > 0) parts.push(`未完成 ${unfinished} 项`);
  let overallComment = `${parts.join(" · ")}。`;

  const runawayCount = blackholeSlices.filter((s) => s.runaway).length;
  if (runawayCount > 0) {
    overallComment += `今日优先处理 ${runawayCount} 段失控娱乐的诱因，从环境隔离开始。`;
  } else if (completionRate >= 0.8) {
    overallComment += `节奏很稳，今天沿用同样的排布即可。`;
  } else if (unfinished > 0) {
    overallComment += `今天挑一件最卡手的先动手，完成比完美重要。`;
  }

  const blackholeComment = blackholeCommentOf(blackholeSlices, blackholeMinutes);

  return {
    isReal: true,
    mirror: {
      dateLabel,
      completionRate,
      doneCount,
      totalCount,
      deepWorkMinutes,
      blackholeMinutes,
      blackholeSlices,
      blackholeComment,
      /**
       * 以下为叙事字段：微复盘 / 深夜深潜的沉淀，等 `mirror_snapshots`
       * 落库链路接入后从云端回填。在那之前**保持空**——
       * 绝不用预置文案冒充用户自己写下的感悟。
       * 注意 `lessons` 是唯一已经落库的真实叙事：它直接来自任务上的微复盘笔记。
       */
      memoryFragments: [],
      mostTouching: "",
      lessons,
      insightCards: [],
      bedtimeReflection: "",
      morningPlan: "",
      overallComment,
    },
  };
}
