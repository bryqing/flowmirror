/**
 * 晨间心锚（Morning Anchor）数据访问层
 * 隔离 Supabase 细节，供晨间心锚组件调用。
 * 字段映射：slogan / action / source / date / created_at ↔ MorningAnchorEntry
 *
 * 降级策略（与灵感层一致）：
 * - 已登录 + 已配置 Supabase：读写 remote（morning_anchors 表）
 * - 否则：本地 localStorage 快照（未登录也能完整体验每日心锚）
 *
 * 语义：每天一条（date 为本地日期 key，服务端按 user_id + date 唯一）。
 * 同一天重复保存 = 覆盖（upsert），因此「重 roll」天然幂等。
 */
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { MorningAnchorEntry } from "@/lib/types";

const SNAPSHOT_KEY = "flowmirror:anchor:snapshot";

/** 本地日期 key "YYYY-MM-DD"（本地时区） */
export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** "9月10日 · 周四" —— 供 UI 直接渲染的中文日期标签 */
export function dateLabel(d = new Date()): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK_LABELS[d.getDay()]}`;
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
  return `an-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 远端 Supabase 行 → MorningAnchorEntry */
function rowToAnchor(row: Record<string, unknown>): MorningAnchorEntry {
  const source = String(row.source ?? "user");
  return {
    id: String(row.id),
    date: String(row.date ?? ""),
    slogan: String(row.slogan ?? ""),
    action: String(row.action ?? ""),
    source: (source === "ai" || source === "seed" ? source : "user") as MorningAnchorEntry["source"],
    createdAt: String(row.created_at ?? ""),
  };
}

// ---- 本地降级存储 ----

function loadLocal(): MorningAnchorEntry[] {
  return safeGet<MorningAnchorEntry[]>(SNAPSHOT_KEY) ?? [];
}

function saveLocal(list: MorningAnchorEntry[]): void {
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
    console.warn("[FlowMirror] 心锚存储异常，已降级：", e);
    return fallback;
  }
}

export const anchorRepo = {
  /** 读取某日心锚，无则返回 null */
  async fetchByDate(dateKey: string): Promise<MorningAnchorEntry | null> {
    if (!(await isRemoteMode())) {
      return loadLocal().find((a) => a.date === dateKey) ?? null;
    }
    return guard(async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("morning_anchors")
        .select("*")
        .eq("date", dateKey)
        .maybeSingle();

      if (error) {
        console.warn("[FlowMirror] 拉取心锚失败：", error.message);
        return null;
      }
      return data ? rowToAnchor(data as Record<string, unknown>) : null;
    }, null);
  },

  /** 保存某日心锚（同日覆盖）。返回落库后的完整记录 */
  async save(
    dateKey: string,
    slogan: string,
    action: string,
    source: MorningAnchorEntry["source"],
  ): Promise<MorningAnchorEntry | null> {
    const entry: MorningAnchorEntry = {
      id: makeId(),
      date: dateKey,
      slogan,
      action,
      source,
      createdAt: new Date().toISOString(),
    };

    if (!(await isRemoteMode())) {
      // 本地：同日覆盖，按日期倒序保留
      const rest = loadLocal().filter((a) => a.date !== dateKey);
      saveLocal([entry, ...rest]);
      return entry;
    }

    try {
      const supabase = getSupabase();
      // 先取旧行 id，避免 unique 冲突（无则新增）
      const { data: existing } = await supabase
        .from("morning_anchors")
        .select("id")
        .eq("date", dateKey)
        .maybeSingle();

      if (existing && (existing as Record<string, unknown>).id) {
        const { data, error } = await supabase
          .from("morning_anchors")
          .update({ slogan, action, source })
          .eq("id", String((existing as Record<string, unknown>).id))
          .select()
          .single();
        if (error) {
          console.warn("[FlowMirror] 更新心锚失败：", error.message);
          return null;
        }
        return rowToAnchor(data as Record<string, unknown>);
      }

      const { data, error } = await supabase
        .from("morning_anchors")
        .insert({ date: dateKey, slogan, action, source })
        .select()
        .single();

      if (error) {
        console.warn("[FlowMirror] 新增心锚失败：", error.message);
        return null;
      }
      return rowToAnchor(data as Record<string, unknown>);
    } catch (e) {
      console.warn("[FlowMirror] 保存心锚异常，降级本地：", e);
      const rest = loadLocal().filter((a) => a.date !== dateKey);
      saveLocal([entry, ...rest]);
      return entry;
    }
  },
};
