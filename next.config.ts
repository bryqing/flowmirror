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
};

export default nextConfig;