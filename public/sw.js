/**
 * FlowMirror · Service Worker
 * - App Shell 预缓存：离线可打开首页骨架
 * - 静态资源 stale-while-revalidate：快速、离线也能用
 * - 同源导航：network-first，失败回退缓存（保证"离线可启动"）
 * - 跨域（Supabase / 字体 / 图床）走 network-only，不污染缓存
 *
 * 缓存版本升级：只改 CACHE_VERSION，旧 cache 会被自动清掉
 */
const CACHE_VERSION = "v1";
const SHELL_CACHE = `flowmirror-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `flowmirror-runtime-${CACHE_VERSION}`;

// 预缓存 App Shell（核心静态资源 + 关键页面）
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 单独 add 容错，避免一条失败整体回滚
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[SW] precache miss:", url, err);
          })
        )
      );
      // 立即激活，不等旧 SW 关闭
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      // 立即接管所有客户端
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 跨域：放行（不要替浏览器缓存第三方，避免 CORS / Opaque 污染）
  if (url.origin !== self.location.origin) return;

  // 同源导航（HTML 文档）：network-first，回退到缓存首页骨架
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // Next.js 静态资源（_next/static、icon、manifest）：stale-while-revalidate
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 其他同源 GET：默认 network-first（保守）
  event.respondWith(
    fetch(req).catch(async () => {
      const cached = await caches.match(req);
      return cached || Response.error();
    })
  );
});

async function networkFirstNavigation(req) {
  try {
    const fresh = await fetch(req);
    // 同步更新 shell 缓存
    const cache = await caches.open(SHELL_CACHE);
    cache.put("/", fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    // 离线：回退到缓存的首页
    const cached = await caches.match("/");
    if (cached) return cached;
    return new Response(
      "<h1 style='color:#f4f5f8;background:#0b0e14;font-family:sans-serif;padding:24px;'>FlowMirror 离线模式</h1><p style='color:#9aa0b0;background:#0b0e14;font-family:sans-serif;padding:0 24px 24px;'>网络不可用，且本地暂无可用页面。</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || Response.error();
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icon") ||
    /\.(png|svg|ico|webp|woff2?|css|js)$/i.test(url.pathname)
  );
}

// 允许页面主动触发 skipWaiting（备用通道，客户端发 { type: "SKIP_WAITING" }）
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
