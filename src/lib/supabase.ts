"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * FlowMirror Supabase 客户端封装
 * - 浏览器端：createBrowserClient 单例（cookie 会话）
 * - 服务端：createServerClient 工具方法（供 Route Handlers / Server Components 使用）
 *
 * ── 关于「国内直连被阻断」──
 * 中国大陆网络直连 `https://<ref>.supabase.co` 会被线路阻断（ERR_CONNECTION_CLOSED）。
 * 因此浏览器端在**生产环境**改走同源反向代理：
 *
 *     浏览器  →  <站点 origin>/api/supabase/<path>
 *             →  （next.config.ts rewrites 透传）
 *             →  https://<ref>.supabase.co/<path>
 *
 * 同源带来的额外好处：没有跨域、没有 TLS 中间阻断，`apikey` / `Authorization` /
 * `Prefer` / `Cookie` 全部原样透传，RLS 与鉴权仍由 Supabase 独立裁决。
 *
 * 开发环境与服务端（Netlify Functions / RSC）保持直连真实地址：
 * 前者便于本机调试与抓包，后者本就不受终端网络限制。
 *
 * ⚠️ 已知限制：Supabase Realtime 走 WebSocket，而 HTTP 反向代理无法承载 WS 升级请求。
 *    故代理模式下由 `isRealtimeAvailable()` 返回 false，多端同步改用轮询回补
 *    （见 `flow-context.tsx` 的订阅门控与轮询降级）。
 */

/** 去掉结尾斜杠，避免拼出 `//auth/v1` 这类路径 */
const RAW_SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 同源反向代理前缀，必须与 next.config.ts 的 rewrites.source 保持一致 */
export const SUPABASE_PROXY_PATH = "/api/supabase";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * 浏览器端是否启用同源反向代理。
 * 仅在「浏览器 + 生产构建」时启用：开发环境仍走直连，避免本机调试被代理层干扰。
 */
export function isSupabaseProxied(): boolean {
  return isBrowser() && process.env.NODE_ENV === "production" && Boolean(RAW_SUPABASE_URL);
}

/**
 * Realtime（WebSocket）是否可用。
 * 走代理时 WS 无法穿过后端，返回 false —— 调用方应跳过 `.channel().subscribe()`，
 * 否则底层会以 `wss://<origin>/api/supabase/realtime/v1` 无限重连、持续刷错误日志。
 */
export function isRealtimeAvailable(): boolean {
  return !isSupabaseProxied();
}

/** 当前实际使用的 Supabase 基址（浏览器/服务端分别解析） */
function resolveSupabaseUrl(): string {
  if (!RAW_SUPABASE_URL) return "";
  if (isSupabaseProxied()) {
    return `${window.location.origin}${SUPABASE_PROXY_PATH}`;
  }
  return RAW_SUPABASE_URL;
}

function isConfigured(): boolean {
  return Boolean(RAW_SUPABASE_URL && supabaseAnonKey);
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isConfigured()) {
    throw new Error(
      "Supabase 未配置：缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  if (!client) {
    client = createBrowserClient(resolveSupabaseUrl(), supabaseAnonKey!);
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
 * - 始终使用真实地址直连：服务端运行在 Netlify，不受国内终端网络限制
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

  return createServerClient(RAW_SUPABASE_URL, supabaseAnonKey!, {
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
