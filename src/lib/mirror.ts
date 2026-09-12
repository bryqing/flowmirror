/**
 * FlowMirror 昨日之镜 · 真实指标计算
 *
 * 设计原则：**指标全部可核对，叙事才允许是示例。**
 *
 * 昨日之镜里有两类内容，来源完全不同，绝不能混为一谈：
 *
 *   A. 可计算指标 —— 完成率、完成/总数、各板块时长、黑洞切片、踩坑教训。
 *      这些必须**直接从前一天的真实任务记录算出来**（本文件负责），
 *      不允许再读 mock：完成率是用户唯一会盯着看的数字，编一个 71% 毫无意义。
 *
 *   B. AI 叙事 —— 记忆碎片、认知金句、最触动的事、睡前感悟、今晨计划、经验卡。
 *      它们产自「微复盘 + 深夜深潜」，目前**还没有落库链路**（表 `mirror_snapshots`
 *      已建但未接入），所以只有 `seed` 示例可用。接入后替换 seed 即可，
 *      本文件的调用方已用 `isReal` 把它们与真实指标区分开显示。
 *
 * 前一天一条任务都没有时不会伪造记录：`isReal` 返回 false，
 * 调用方据此打「示例数据」标记，而不是让用户以为昨天真的完成了 5 项。
 */

import type { DayMirror, Task, TimeSlice } from "./types";
import { fmtDateLabel, taskWindow, effectiveMinutes, minutesToClock } from "./task-time";
import { fmtDuration } from "./utils";

export interface DayMirrorResult {
  mirror: DayMirror;
  /**
   * true  = 全部指标来自前一天的真实任务记录
   * false = 前一天无任何记录，整套内容回退为示例数据
   */
  isReal: boolean;
}

/** 空镜像：没有任何记录、也没有示例可回退时使用 */
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
  return tasks
    .filter((t) => t.category === category)
    .reduce((sum, t) => sum + effectiveMinutes(t), 0);
}

/** 由真实任务派生黑洞切片（含失控判定：实际跨度超出计划时长即为失控段） */
function blackholeSlicesOf(tasks: Task[]): TimeSlice[] {
  return tasks
    .filter((t) => t.category === "blackhole")
    .map((task) => {
      const w = taskWindow(task);
      if (!w) return null;
      const minutes = Math.max(0, w.end - w.start);
      const planned = task.plannedDuration ?? task.blackholeMinutes ?? 0;
      const slice: TimeSlice = {
        start: minutesToClock(w.start),
        end: minutesToClock(w.end),
        label: task.title,
        runaway: planned > 0 && minutes > planned,
      };
      return slice;
    })
    .filter((s): s is TimeSlice => s !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** 由真实微复盘派生「踩坑教训」（有卡点或笔记的才算一条） */
function lessonsOf(tasks: Task[]): { taskTitle: string; text: string }[] {
  const lessons: { taskTitle: string; text: string }[] = [];
  for (const task of tasks) {
    for (const review of task.microReviews) {
      const text = review.note.trim();
      if (!text) continue;
      lessons.push({ taskTitle: task.title, text });
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
 * @param seed     AI 叙事示例（记忆碎片 / 经验卡等），无落库时的占位内容
 */
export function buildDayMirror(
  tasks: Task[],
  dateKey: string,
  seed?: DayMirror
): DayMirrorResult {
  const dateLabel = fmtDateLabel(dateKey);
  const isReal = tasks.length > 0;

  // 无记录：整套回退示例（调用方会打「示例数据」标记），没有示例就是干净的零值
  if (!isReal) {
    return {
      mirror: seed ? { ...seed, dateLabel } : { ...EMPTY_MIRROR, dateLabel },
      isReal: false,
    };
  }

  const totalCount = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const completionRate = totalCount > 0 ? doneCount / totalCount : 0;
  const deepWorkMinutes = categoryMinutes(tasks, "deep-work");
  const blackholeMinutes = categoryMinutes(tasks, "blackhole");
  const blackholeSlices = blackholeSlicesOf(tasks);
  const lessons = lessonsOf(tasks);

  /** 与数字自洽的总体评述（不用 seed 里那份写死的评述，否则会和上方数字打架） */
  const parts = [`完成率 ${Math.round(completionRate * 100)}%，${doneCount}/${totalCount} 项完成`];
  if (deepWorkMinutes > 0) parts.push(`紧急重要 ${fmtDuration(deepWorkMinutes)}`);
  if (blackholeMinutes > 0) parts.push(`休闲娱乐 ${fmtDuration(blackholeMinutes)}`);
  const unfinished = tasks.filter((t) => t.status === "pending" || t.status === "in-progress").length;
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
      // 以下为 AI 叙事：尚未落库，沿用示例；接入后替换这里即可
      memoryFragments: seed?.memoryFragments ?? [],
      mostTouching: seed?.mostTouching ?? "",
      lessons: lessons.length > 0 ? lessons : (seed?.lessons ?? []),
      insightCards: seed?.insightCards ?? [],
      bedtimeReflection: seed?.bedtimeReflection ?? "",
      morningPlan: seed?.morningPlan ?? "",
      overallComment,
    },
  };
}
