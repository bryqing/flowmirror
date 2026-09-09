/**
 * 灵感/思考流（Thought）数据访问层
 * 隔离 Supabase 细节，供前端组件与状态层调用。
 * 字段映射：content / ai_expansion / tags / task_id / date / created_at ↔ Thought
 *
 * 降级策略（与任务层一致）：
 * - 已登录 + 已配置 Supabase：读写 remote（thoughts 表）
 * - 否则：本地 localStorage 快照（未登录也能完整体验记录/标签/检索）
 */
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Thought } from "@/lib/types";

const SNAPSHOT_KEY = "flowmirror:thoughts:snapshot";

/** 本地日期 key "YYYY-MM-DD"（本地时区） */
export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
    /* ignore */
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `th-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 远端 Supabase 行 → Thought */
function rowToThought(row: Record<string, unknown>): Thought {
  const taskId = row.task_id;
  return {
    id: String(row.id),
    content: String(row.content ?? ""),
    aiExpansion: String(row.ai_expansion ?? ""),
    createdAt: String(row.created_at ?? ""),
    date: String(row.date ?? ""),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    taskId: taskId ? String(taskId) : undefined,
  };
}

/** Thought → 远端行（不含 id/user_id，由服务端生成） */
function thoughtToRow(t: Partial<Thought>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (t.content !== undefined) row.content = t.content;
  if (t.aiExpansion !== undefined) row.ai_expansion = t.aiExpansion;
  if (t.tags !== undefined) row.tags = t.tags;
  if (t.date !== undefined) row.date = t.date;
  if (t.taskId !== undefined) row.task_id = t.taskId || null;
  return row;
}

// ---- 本地降级存储 ----

function loadLocal(): Thought[] {
  return safeGet<Thought[]>(SNAPSHOT_KEY) ?? [];
}

function saveLocal(list: Thought[]): void {
  safeSet(SNAPSHOT_KEY, list);
}

/** 是否走远程（登录 + 配置齐全） */
async function isRemoteMode(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    // 用本地会话判断，避免 getUser() 发网络请求（未登录时返回 401 噪声）
    const { data } = await getSupabase().auth.getSession();
    return data.session !== null;
  } catch {
    return false;
  }
}

/**
 * 包一层 try...catch：任何异常都降级到本地存储或安全默认值，
 * 绝不向上抛 unhandled rejection（否则会触发 Next.js 错误浮标）。
 */
async function guard<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[FlowMirror] 灵感存储异常，已降级：", e);
    return fallback;
  }
}

export const thoughtRepo = {
  /** 拉取某日的灵感记录（按创建时间倒序） */
  async fetchByDate(dateKey: string): Promise<Thought[]> {
    if (!(await isRemoteMode())) {
      return loadLocal()
        .filter((t) => t.date === dateKey)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return guard(async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("thoughts")
        .select("*")
        .eq("date", dateKey)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("[FlowMirror] 拉取灵感失败：", error.message);
        return [];
      }
      return (data ?? []).map(rowToThought);
    }, []);
  },

  /** 拉取当前用户的全部灵感（打破单日限制，供「全部搜索」模式检索历史） */
  async fetchAll(): Promise<Thought[]> {
    if (!(await isRemoteMode())) {
      return loadLocal().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return guard(async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("thoughts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("[FlowMirror] 拉取全部灵感失败：", error.message);
        return [];
      }
      return (data ?? []).map(rowToThought);
    }, []);
  },

  /** 新增一条灵感（可选标签），返回落库后的完整记录（含真实 id） */
  async insert(content: string, dateKey: string, tags: string[] = []): Promise<Thought | null> {
    // 本地降级：未登录 / 未配置，直接写 localStorage 快照
    if (!(await isRemoteMode())) {
      const thought: Thought = {
        id: makeId(),
        content,
        aiExpansion: "",
        createdAt: new Date().toISOString(),
        date: dateKey,
        tags,
      };
      saveLocal([thought, ...loadLocal()]);
      return thought;
    }
    // 远程路径：任何异常（网络中断 / token 失效 / RLS 拒绝）都降级到本地，绝不 reject
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("thoughts")
        .insert({ content, date: dateKey, ai_expansion: "", tags })
        .select()
        .single();

      if (error) {
        console.warn("[FlowMirror] 新增灵感失败：", error.message);
        return null;
      }
      return rowToThought(data as Record<string, unknown>);
    } catch (e) {
      console.warn("[FlowMirror] 新增灵感异常，降级本地：", e);
      const thought: Thought = {
        id: makeId(),
        content,
        aiExpansion: "",
        createdAt: new Date().toISOString(),
        date: dateKey,
        tags,
      };
      saveLocal([thought, ...loadLocal()]);
      return thought;
    }
  },

  /** 更新灵感（AI 拓展 / 标签 / 关联任务） */
  async update(id: string, patch: Partial<Thought>): Promise<boolean> {
    if (!(await isRemoteMode())) {
      const list = loadLocal().map((t) => (t.id === id ? { ...t, ...patch } : t));
      saveLocal(list);
      return true;
    }
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("thoughts")
        .update(thoughtToRow(patch))
        .eq("id", id);

      if (error) {
        console.warn("[FlowMirror] 更新灵感失败：", error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn("[FlowMirror] 更新灵感异常，降级本地：", e);
      const list = loadLocal().map((t) => (t.id === id ? { ...t, ...patch } : t));
      saveLocal(list);
      return true;
    }
  },

  /** 删除灵感 */
  async remove(id: string): Promise<boolean> {
    if (!(await isRemoteMode())) {
      saveLocal(loadLocal().filter((t) => t.id !== id));
      return true;
    }
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("thoughts").delete().eq("id", id);
      if (error) {
        console.warn("[FlowMirror] 删除灵感失败：", error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn("[FlowMirror] 删除灵感异常，降级本地：", e);
      saveLocal(loadLocal().filter((t) => t.id !== id));
      return true;
    }
  },
};
