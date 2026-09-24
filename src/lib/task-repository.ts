import { coerceTaskCategory, coerceTaskStatus, type Task } from "./types";
import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * Task 数据访问层 —— **云端是唯一权威数据源**。
 *
 * ⚠️ 本层曾经在拉取失败时 `return TODAY_TASKS`（内置演示数据），那是一个
 * **静默数据损坏**级别的设计缺陷：
 *   1) 用户在手机上录入的真实任务，电脑端因为一次网络抖动/RLS 未配置而拉取失败，
 *      界面却"有数据"——于是完全看不出同步坏了，只看到一批陌生的假任务；
 *   2) 更糟的是调用方会把这批假数据当成"云端返回"写进本地快照，
 *      下一次刷新就从快照里把假数据读回来 —— 假数据就此永久占据那一天的视图。
 * 因此本层**永不返回 mock**：失败必须如实表现为 `null`，由调用方保持本地现状并提示。
 */

export interface TaskRepository {
  /**
   * 拉取当前用户某日任务（按 scheduled_time 排序）。
   *
   * 返回 `null` 表示**拉取失败**（网络/权限/未配置），与"拉到了空数组"严格区分：
   * 前者调用方应保持本地状态，后者代表"这一天确实没有任务"，必须如实呈现。
   */
  fetchTasks(dateKey: string): Promise<Task[] | null>;
  /** 新增任务，返回持久化后的真实任务（失败返回 null） */
  insertTask(task: Task, dateKey: string): Promise<Task | null>;
  /** 更新任务，返回是否成功 */
  updateTask(task: Task): Promise<boolean>;
  /** 删除任务，返回是否成功 */
  deleteTask(id: string): Promise<boolean>;
}

/**
 * 远端 Supabase 行 → 前端 Task 模型。
 *
 * ⚠️ 这里是**云端数据进前端的唯一闸口**，所有可选字段都必须在这里落定：
 * 数组字段补 `[]`，两个枚举字段过 `coerce*`。少补一个，那条记录就会带着
 * undefined 一路走到渲染层，在某个 `.length` / 查表处把整棵树带走
 * （表现为"线上整页白屏"，而根因只是数据库里一行缺字段的历史数据）。
 */
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    status: coerceTaskStatus(row.status),
    category: coerceTaskCategory(row.category),
    scheduledTime: (row.scheduled_time as string) ?? undefined,
    plannedDuration: (row.planned_duration as number) ?? undefined,
    actualDuration: (row.actual_duration as number) ?? undefined,
    blackholeMinutes: (row.blackhole_minutes as number) ?? undefined,
    timeSlices: (row.time_slices as Task["timeSlices"]) ?? [],
    microReviews: (row.micro_reviews as Task["microReviews"]) ?? [],
    insights: (row.insights as string[]) ?? [],
    sops: (row.sops as string[]) ?? [],
    pitfalls: (row.pitfalls as string[]) ?? [],
    // 只读映射：created_at 由数据库生成，写入时不回传（见 taskToRow）
    createdAt: (row.created_at as string) ?? undefined,
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
  async fetchTasks(dateKey: string): Promise<Task[] | null> {
    if (!isSupabaseConfigured()) return null;
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("date", dateKey)
        .order("scheduled_time", { ascending: true, nullsFirst: false });

      if (error) {
        // 绝不回退 mock：失败就是失败，让调用方保留本地状态并如实提示
        console.warn("[FlowMirror] 拉取任务失败（保持本地状态）：", error.message);
        return null;
      }
      return (data ?? []).map(rowToTask);
    } catch (err) {
      console.warn("[FlowMirror] 拉取任务异常（保持本地状态）：", err);
      return null;
    }
  },

  async insertTask(task: Task, dateKey: string): Promise<Task | null> {
    if (!isSupabaseConfigured()) return null;
    try {
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
    } catch (err) {
      console.warn("[FlowMirror] 新增任务异常：", err);
      return null;
    }
  },

  async updateTask(task: Task): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;
    try {
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
    } catch (err) {
      console.warn("[FlowMirror] 更新任务异常：", err);
      return false;
    }
  },

  async deleteTask(id: string): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) {
        console.warn("[FlowMirror] 删除任务失败：", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn("[FlowMirror] 删除任务异常：", err);
      return false;
    }
  },
};

/**
 * 拉取当前用户某日任务（严格模式，与 `supabaseTaskRepo.fetchTasks` 等价）。
 *
 * 保留这个名字是因为调用点读起来更直白：拿到 `null` 一律**跳过本轮**，
 * 绝不拿假数据或空数据去覆盖本地 —— 这在「后台静默轮询」这种用户无感知的场景里
 * 尤其重要（一次瞬时网络抖动不该让用户的真实数据消失）。
 */
export const fetchTasksOrNull = (dateKey: string): Promise<Task[] | null> =>
  supabaseTaskRepo.fetchTasks(dateKey);

/** 是否走远程（登录 + 配置齐全） */
export function isRemoteMode(): boolean {
  return isSupabaseConfigured();
}

/**
 * 拉取「待执行清单」（category=rest）的**全局池**：不带 `date` 条件。
 *
 * 这是 Q3 从「按日切片」改成「常驻池」在数据层的落点：它一旦绑定 selectedDate，
 * 翻到任意历史日期池子就会变空 —— 那正是本次要修掉的症状。
 *
 * 返回 `null` 表示**拉取失败**（网络/权限/未配置），与「拉到了空数组」严格区分：
 * 调用方对二者的处理完全不同（失败保持本地，空则如实呈现）。
 */
export async function fetchBacklogOrNull(): Promise<Task[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("category", "rest")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[FlowMirror] 拉取待执行池失败（保持本地状态）：", error.message);
      return null;
    }
    return (data ?? []).map(rowToTask);
  } catch (err) {
    console.warn("[FlowMirror] 拉取待执行池异常（保持本地状态）：", err);
    return null;
  }
}

export function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
