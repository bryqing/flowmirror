import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/flowmirror",
    name: "FlowMirror · 掌控时间黑洞",
    short_name: "FlowMirror",
    description: "个人效能与心智成长系统：掌控时间黑洞，照见心智成长。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "fullscreen", "minimal-ui"],
    orientation: "portrait",
    lang: "zh-CN",
    dir: "ltr",
    background_color: "#0b0e14",
    theme_color: "#0b0e14",
    categories: ["productivity", "lifestyle", "health"],
    prefer_related_applications: false,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "开始微复盘",
        short_name: "复盘",
        url: "/?action=review",
        description: "快速进入微复盘",
      },
      {
        name: "今日战局",
        short_name: "今日",
        url: "/?section=today",
        description: "查看今日任务四象限",
      },
    ],
  };
}
