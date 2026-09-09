"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * FlowMirror Supabase 客户端封装
 * - 浏览器端：createBrowserClient 单例（cookie 会话）
 * - 服务端：createServerClient 工具方法（供 Route Handlers / Server Components 使用）
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function isConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isConfigured()) {
    throw new Error(
      "Supabase 未配置：缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  if (!client) {
    client = createBrowserClient(supabaseUrl!, supabaseAnonKey!);
  }
  return client;
}

/** 是否已配置 Supabase（用于优雅降级到 mock） */
export function isSupabaseConfigured(): boolean {
  return isConfigured();
}

/** 当前登录用户 id，未登录返回 null */
export async function currentUserId(): Promise<string | null> {
  if (!isConfigured()) return null;
  const { data } = await getSupabase().auth.getUser();
  return data.user?.id ?? null;
}

/**
 * 服务端 Supabase 客户端（仅服务端代码使用）
 * - 供 Route Handlers / Server Components / Server Actions 调用
 * - 需要从 cookie store 读取会话，故不接受 cookie 参数时用 next/headers 的 cookies()
 */
export async function createServerSupabase() {
  if (!isConfigured()) {
    throw new Error(
      "Supabase 未配置：缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  // 动态导入，避免在客户端 bundle 中引入 next/headers
  const { createServerClient } = await import("@supabase/ssr");
  const { cookies } = await import("next/headers");

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // 在 Server Component 中调用 set 会抛错，可安全忽略（中间件会刷新会话）
        }
      },
    },
  });
}
