import type { NextConfig } from "next";

/**
 * Supabase 反向代理（BFF / Rewrite）
 * ---------------------------------------------------------------------------
 * 背景：中国大陆网络直连 `https://<ref>.supabase.co` 会被阻断（ERR_CONNECTION_CLOSED）。
 * 方案：把 Supabase 的 HTTP 端点整体挂到本站同源路径 `/api/supabase/*` 之下，
 *       再由下面的 rewrites 透传到真实 Supabase。
 * 收益：同源 → 无跨域、无 TLS 阻断、Cookie 天然可用；手机端无需任何代理工具。
 *
 * ⚠️ 该变量的值会写进构建产物（rewrite 路由表），因此必须在 **构建环境** 中可见
 *    （Netlify → Environment variables，作用域要勾上 Builds）。
 */
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

if (!supabaseUrl) {
  console.warn(
    "[FlowMirror] 未检测到 NEXT_PUBLIC_SUPABASE_URL，/api/supabase 反向代理不会启用。"
  );
}

const nextConfig: NextConfig = {
  // 关闭开发环境左下角的 Next.js 调试浮标（N 图标 / 路由状态指示器），
  // 避免英文底层调试遮罩干扰手机与电脑端视觉；系统级提示统一走自有中文 Toast。
  // 注：Next.js 16 已移除 appIsrStatus / buildActivity 选项，只支持 position 或 false。
  devIndicators: false,
  // 允许开发模式下通过 127.0.0.1、局域网 IP、公网穿透域名访问 HMR / 字体等 dev 资源，
  // 避免 Next.js 16 默认同源限制阻断浏览器/手机端调试体验
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "192.168.*.*",
    "*.trycloudflare.com",
    "*.localtunnel.me",
    "*.loca.lt",
  ],

  /**
   * Supabase 同源反向代理。
   *
   * - source `/api/supabase/:path*` 覆盖 Supabase 全部 HTTP 子路径：
   *   auth（登录/注册/刷新令牌）、rest（PostgREST 增删改查）、storage、functions。
   * - destination `${NEXT_PUBLIC_SUPABASE_URL}/:path*` 为外部绝对地址，
   *   Next.js 会以**透传**方式转发请求：方法、请求体、查询串、以及全部请求标头
   *   （`apikey`、`Authorization`、`Prefer`、`Content-Type`、`Cookie`）均原样带给 Supabase，
   *   响应标头（含 `Set-Cookie`）亦原样返回浏览器。
   * - 不做任何鉴权改写：RLS 与 JWT 校验依旧由 Supabase 负责，代理层对会话完全透明。
   *
   * 注意：这里用 rewrites 而非 catch-all Route Handler，是因为 Netlify 会把 rewrite
   *      编译成边缘重定向规则（零函数调用、零冷启动）；Route Handler 会让每个
   *      Supabase 请求都真实执行一次 Serverless 函数，徒增延迟与配额消耗。
   */
  async rewrites() {
    if (!supabaseUrl) return [];
    return [
      {
        source: "/api/supabase/:path*",
        destination: `${supabaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
