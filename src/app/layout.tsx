import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FlowMirror · 掌控时间黑洞",
  description:
    "个人效能与心智成长系统：自然语言指令、沉浸番茄钟、做完即追问的微复盘、24 小时时间黑洞热力图与昨日之镜。",
  applicationName: "FlowMirror",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FlowMirror",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icon-192.png",
  },
  formatDetection: {
    telephone: false,
  },
  // 显式补充 iOS Safari 识别「以独立应用运行」的关键 meta（Next.js 的 appleWebApp.capable
  // 默认输出的是 mobile-web-app-capable，缺 apple-mobile-web-app-capable 会让 iPhone 无法进入 standalone 模式）
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#f8fafc",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  maximumScale: 1,
  userScalable: false,
  colorScheme: "light",
};

/**
 * 启动看门狗（内联脚本，先于任何 bundle 执行）
 *
 * 目的：防止「僵尸页」——HTML 显示了，但 JS 没能加载/水合，页面看起来正常却完全点不动。
 * 因此探测必须在「不依赖任何打包产物」的前提下完成：本脚本直接内联在 <body> 首部，
 * 只有原生 setTimeout + DOM API。若到点还没收到应用挂载信号，就浮出一条明确的告警条，
 * 把「静默假死」变成「用户可理解、可一键重载」的显式故障。
 *
 * 应用侧在 AppShell 挂载后置 window.__fmAppMounted = true 即可解除。
 *
 * ## 计时方式：**文档就绪后才起算**，而不是从脚本执行那一刻起算
 *
 * 早先版本是一个死的 9000ms 定时器，这在线上会**误报**：Netlify Functions 冷启动时
 * 首屏 HTML 本身就可能要 10s 以上（实测线上 curl 取 HTML 耗时 12.1s，预热后回落到
 * 2.5s 内挂载完成）。也就是说页面资源一切正常，只是还没轮到 JS 执行，告警条就先弹了
 * —— 用户看到的是「资源未加载」+ 一个尚未水合、只有占位符的空白看板，很容易被
 * 误判成"代码崩了"，而实际上什么都没坏。
 *
 * 所以改成两段式：
 *   1. `document.readyState === "complete"`（所有资源请求都有了结果）之后，
 *      再给应用 GRACE_MS 的水合窗口 —— 这才是"资源齐了但 JS 没跑起来"的真正判据；
 *   2. 同时保留 HARD_LIMIT_MS 的绝对上限，避免某个请求永远挂着、
 *      readyState 卡在 loading 导致告警永不出现（那就退回成"静默假死"了）。
 *
 * 注意：真正的资源 404 / 脚本执行报错仍会走到这里 —— 那类故障下 readyState
 * 同样会到 complete，宽限期一过就如实报警，判据没有被削弱。
 */
const BOOT_WATCHDOG = `(function(){
  window.__fmAppMounted = false;
  var GRACE_MS = 8000;    // 文档就绪后留给 React 水合的时间
  var HARD_LIMIT_MS = 30000; // 绝对上限：readyState 一直不 complete 也要报警
  var startedAt = Date.now();
  var readyAt = document.readyState === 'complete' ? startedAt : 0;

  function show(){
    if (window.__fmAppMounted) return;
    if (document.getElementById('fm-boot-warning')) return;
    var box = document.createElement('div');
    box.id = 'fm-boot-warning';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px));background:#1c1408;border-top:1px solid rgba(245,158,11,0.35);color:#fde68a;font:13px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 -8px 32px rgba(0,0,0,0.5)';
    var text = document.createElement('span');
    text.style.cssText = 'flex:1 1 220px;min-width:0';
    text.textContent = '页面资源未能完整加载，当前界面无法交互。请检查网络或本地服务是否正常，然后重新加载。';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '重新加载';
    btn.style.cssText = 'flex:0 0 auto;background:#d97706;color:#ffffff;border:0;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer';
    btn.onclick = function(){ window.location.reload(); };
    box.appendChild(text);
    box.appendChild(btn);
    (document.body || document.documentElement).appendChild(box);
  }

  function check(){
    if (window.__fmAppMounted) return;
    var now = Date.now();
    if (!readyAt && document.readyState === 'complete') readyAt = now;
    if (now - startedAt >= HARD_LIMIT_MS) return show();
    if (readyAt && now - readyAt >= GRACE_MS) return show();
    window.setTimeout(check, 400);
  }

  if (document.readyState === 'complete') {
    window.setTimeout(check, GRACE_MS);
  } else {
    document.addEventListener('readystatechange', function(){
      if (document.readyState === 'complete' && !readyAt) readyAt = Date.now();
    });
    window.setTimeout(check, 400);
  }
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG }} />
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
