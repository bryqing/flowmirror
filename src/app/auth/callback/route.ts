import { NextResponse, type NextRequest } from "next/server";

/**
 * 邮箱魔法链接登录回调
 * - Supabase OTP 邮件链接会带 ?token_hash=xxx&type=magiclink 回跳到 emailRedirectTo
 * - 本路由用 verifyOtp 消费 token_hash，建立会话后重定向回首页
 * - 会话 cookie 由 @supabase/ssr 的 createServerClient 写入
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/";

  // 无 token_hash：直接回首页（可能是误入）
  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/`);
  }

  const { createServerClient } = await import("@supabase/ssr");
  const { cookies } = await import("next/headers");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(`${origin}/`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
          // Server Component 中 set 可能抛错，忽略（浏览器端会继续走 onAuthStateChange）
        }
      },
    },
  });

  // 消费 token_hash，type 传 magiclink（也可省略，verifyOtp 会自动识别）
  const { error } = await supabase.auth.verifyOtp({
    type: (type === "recovery" ? "recovery" : "email") as "email" | "recovery",
    token_hash: tokenHash,
  });

  if (error) {
    // 校验失败：回首页并带错误标记
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error.message)}`);
  }

  // 成功：重定向回首页（会话已写入 cookie，前端 onAuthStateChange 会感知）
  return NextResponse.redirect(`${origin}${next}`);
}
