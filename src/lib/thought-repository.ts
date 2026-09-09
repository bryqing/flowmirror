/**
 * 灵感/思考流（Thought）数据访问层
 * 隔离 Supabase 细节，供前端组件与状态层调用。
 * 字段映射：content / ai_expansion / tags / date / created_at ↔ Thought
 */
import { getSupabase } from "@/lib/supabase";
import type { Thought } from "@/lib/types";

/** 本地日期 key "YYYY-MM-DD"（本地时区） */
export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 远端 Supabase 行 → Thought */
function rowToThought(row: Record<string, unknown>): Thought {
  return {
    id: String(row.id),
    content: String(row.content ?? ""),
    aiExpansion: String(row.ai_expansion ?? ""),
    createdAt: String(row.created_at ?? ""),
    date: String(row.date ?? ""),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  };
}

/** Thought → 远端行（不含 id/user_id，由服务端生成） */
function thoughtToRow(t: Partial<Thought>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (t.content !== undefined) row.content = t.content;
  if (t.aiExpansion !== undefined) row.ai_expansion = t.aiExpansion;
  if (t.tags !== undefined) row.tags = t.tags;
  if (t.date !== undefined) row.date = t.date;
  return row;
}

export const thoughtRepo = {
  /** 拉取某日的灵感记录（按创建时间倒序） */
  async fetchByDate(dateKey: string): Promise<Thought[]> {
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
  },

  /** 新增一条灵感，返回服务端落库后的完整记录（含真实 id） */
  async insert(content: string, dateKey: string): Promise<Thought | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("thoughts")
      .insert({ content, date: dateKey, ai_expansion: "", tags: [] })
      .select()
      .single();

    if (error) {
      console.warn("[FlowMirror] 新增灵感失败：", error.message);
      return null;
    }
    return rowToThought(data as Record<string, unknown>);
  },

  /** 更新灵感（主要用于写入 AI 拓展内容） */
  async update(id: string, patch: Partial<Thought>): Promise<boolean> {
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
  },

  /** 删除灵感 */
  async remove(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase.from("thoughts").delete().eq("id", id);
    if (error) {
      console.warn("[FlowMirror] 删除灵感失败：", error.message);
      return false;
    }
    return true;
  },
};
