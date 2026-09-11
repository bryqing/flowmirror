import type { Task } from "./types";
import { TODAY_TASKS } from "./mock-data";
import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * Task 数据访问层
 * - 已登录 + 已配置 Supabase：读写 remote（tasks 表）
 * - 否则：降级到 mock（内存态，保持开发体验）
 */

export interface TaskRepository {
  /** 拉取当前用户某日任务（按 scheduled_time 排序） */
  fetchTasks(dateKey: string): Promise<Task[]>;
  /** 新增任务，返回持久化后的真实任务（失败返回 null） */
  insertTask(task: Task, dateKey: string): Promise<Task | null>;
  /** 更新任务，返回是否成功 */
  updateTask(task: Task): Promise<boolean>;
  /** 删除任务，返回是否成功 */
  deleteTask(id: string): Promise<boolean>;
}

/** 远端 Supabase 行 → 前端 Task 模型 */
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as Task["status"],
    category: row.category as Task["category"],
    scheduledTime: (row.scheduled_time as string) ?? undefined,
    plannedDuration: (row.planned_duration as number) ?? undefined,
    actualDuration: (row.actual_duration as number) ?? undefined,
    blackholeMinutes: (row.blackhole_minutes as number) ?? undefined,
    timeSlices: (row.time_slices as Task["timeSlices"]) ?? [],
    microReviews: (row.micro_reviews as Task["microReviews"]) ?? [],
    insights: (row.insights as string[]) ?? [],
    sops: (row.sops as string[]) ?? [],
    pitfalls: (row.pitfalls as string[]) ?? [],
  };
}

/** 前端 Task 模型 → Supabase 行 */
function taskToRow(task: Task) {
  return {
    title: task.title,
    status: task.status,
    category: task.category,
    scheduled_time: task.scheduledTime ?? null,
    planned_duration: task.plannedDuration ?? null,
    actual_duration: task.actualDuration ?? null,
    blackhole_minutes: task.blackholeMinutes ?? null,
    time_slices: task.timeSlices ?? [],
    micro_reviews: task.microReviews ?? [],
    insights: task.insights ?? [],
    sops: task.sops ?? [],
    pitfalls: task.pitfalls ?? [],
  };
}

export const supabaseTaskRepo: TaskRepository = {
  async fetchTasks(dateKey: string): Promise<Task[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("date", dateKey)
      .order("scheduled_time", { ascending: true, nullsFirst: false });

    if (error) {
      console.warn("[FlowMirror] 拉取任务失败，回退 mock：", error.message);
      return TODAY_TASKS;
    }
    return (data ?? []).map(rowToTask);
  },

  async insertTask(task: Task, dateKey: string): Promise<Task | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("tasks")
      .insert({ ...taskToRow(task), date: dateKey })
      .select()
      .single();

    if (error) {
      console.warn("[FlowMirror] 新增任务失败：", error.message);
      return null;
    }
    return rowToTask(data);
  },

  async updateTask(task: Task): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("tasks")
      .update(taskToRow(task))
      .eq("id", task.id);

    if (error) {
      console.warn("[FlowMirror] 更新任务失败：", error.message);
      return false;
    }
    return true;
  },

  async deleteTask(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      console.warn("[FlowMirror] 删除任务失败：", error.message);
      return false;
    }
    return true;
  },
};

/**
 * 拉取当前用户某日任务（严格模式）：任何失败都返回 `null`，**绝不回退 mock**。
 *
 * 专供「后台静默轮询」这类场景使用：轮询是在用户无感知的情况下刷新界面，
 * 若沿用 `fetchTasks` 的 mock 回退，一次瞬时网络抖动就会把用户真实数据
 * 覆写成演示数据（不可接受的静默数据损坏）。调用方拿到 null 时直接跳过本轮。
 */
export async function fetchTasksOrNull(dateKey: string): Promise<Task[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("date", dateKey)
      .order("scheduled_time", { ascending: true, nullsFirst: false });

    if (error) {
      console.warn("[FlowMirror] 轮询拉取任务失败（保持本地状态）：", error.message);
      return null;
    }
    return (data ?? []).map(rowToTask);
  } catch (err) {
    console.warn("[FlowMirror] 轮询拉取任务异常（保持本地状态）：", err);
    return null;
  }
}

/** 是否走远程（登录 + 配置齐全） */
export function isRemoteMode(): boolean {
  return isSupabaseConfigured();
}

export function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
