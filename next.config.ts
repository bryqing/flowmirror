import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许开发模式下通过 127.0.0.1、局域网 IP 访问 HMR / 字体等 dev 资源，
  // 避免 Next.js 16 默认同源限制阻断浏览器调试体验
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.*.*"],
};

export default nextConfig;