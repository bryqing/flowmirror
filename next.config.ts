import type { NextConfig } from "next";

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

  // 代理场景下不要做尾部斜杠归一化：
  // 否则 `/api/supabase/rest/v1/` 这类请求会被 308 改成去掉斜杠的路径，
  // 既多一次往返，也破坏了「原样透传」的语义。
  skipTrailingSlashRedirect: true,

  /**
   * ⚠️ 这里**故意没有** Supabase 的 rewrites 规则 —— 不要加回来。
   *
   * Supabase 的反向代理由 `src/app/api/supabase/[...path]/route.ts` 单独承担，
   * 全线只保留这一个实现。原因（线上实测，非推测）：
   *
   *  1. 若在此处写 `rewrites()` 指向外部 Supabase 地址，Netlify 会改写
   *     `Content-Encoding`（PostHog 官方文档点名此坑），上游压缩内容解码失败 → 500。
   *  2. 若再叠加 netlify.toml 的原生 `[[redirects]] status=200`，Netlify 原生规则
   *     优先级更高，会遮蔽这里；两者并存时排障无法区分是谁在应答。
   *  3. 实测线上原生代理返回的是**空 body 的 text/plain 500**，没有上游 `sb-*` 标头，
   *     也不带 Next.js 运行时的 `Cache-Status: "Next.js"` 标记 —— 黑盒且不可诊断。
   *
   * 收敛为 Route Handler 后，目标地址、请求/响应标头全部可控，失败会返回结构化诊断。
   */
};

export default nextConfig;
