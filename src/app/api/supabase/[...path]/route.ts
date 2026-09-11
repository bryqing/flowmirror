import type { NextRequest } from "next/server";

/**
 * Supabase 同源反向代理（BFF / Route Handler） —— 全线唯一的代理实现
 * ===========================================================================
 * 为什么需要：中国大陆网络直连 `https://<ref>.supabase.co` 会被线路阻断
 * （ERR_CONNECTION_CLOSED），手机端不挂梯子完全无法登录 / 同步。
 * 把 Supabase 全部 HTTP 端点挂到本站同源路径 `/api/supabase/*` 之下即可绕开。
 *
 * ── 为什么是 Route Handler，而不是 netlify.toml 原生 200 重写 / next.config rewrites ──
 * 两条路都试过，实测结论（线上 jocular-pony-b41da7 复现）：
 *
 *  1) `next.config.ts` 的 rewrites 走 Netlify 时会被改写 `Content-Encoding`
 *     （PostHog 官方文档点名此坑）→ 上游压缩内容无法解码 → 500。
 *  2) `netlify.toml` 原生 `[[redirects]] status=200` 跑到 Netlify 边缘代理后，
 *     上游 fetch 直接失败：返回 **空 body 的 text/plain 500**，且响应里既没有
 *     上游的 `sb-*` 标头、也没有 Next.js 运行时的 `Cache-Status: "Next.js"` 标记
 *     （对照：`/api/nope` 的 404 明确带 `Cache-Status: "Next.js"; hit`），
 *     说明请求根本没到 Supabase。且该层的 500 是黑盒，日志在 Netlify 侧不可见。
 *  3) 二者同时存在还会互相遮蔽（Netlify 原生规则优先级更高），排障时无法区分是谁在应答。
 *
 * 因此收敛为**单一实现**：把请求放在 Next.js 的 Route Handler 里转发。
 * 这一层已确认可用（同站点的 `/api/ai/*` 路由正常应答），并且我们完全掌控
 * 目标地址、请求标头与响应标头，出问题也能返回可读的结构化诊断信息，
 * 不再是黑盒 500。
 *
 * ── 透传语义（刻意保持透明）──
 * Supabase 的 RLS 与 JWT 校验依旧由 Supabase 独立裁决，本层不做任何鉴权改写：
 *  - 请求：方法 / 查询串 / 请求体 / `apikey` / `Authorization` / `Prefer` /
 *          `Content-Type` / `Accept` 等原样带给上游。
 *  - 响应：状态码与标头（含 `sb-project-ref`、`Set-Cookie`）原样返回。
 *  - 仅做两处**必须**的规范化（见下方 HOP_BY_HOP / 删除标头注释）。
 *
 * ⚠️ 已知限制：Realtime 走 WebSocket，无法经过 HTTP 代理。
 *    代理模式下由 `src/lib/supabase.ts` 的 `isRealtimeAvailable()` 返回 false，
 *    多端同步改由 `flow-context.tsx` 的轮询回补接管。
 */

/** 去掉结尾斜杠，避免拼出 `//auth/v1` 这类路径 */
const UPSTREAM = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** RFC 7230 逐跳标头：只对单条 TCP 连接有意义，禁止跨代理转发 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** 这些响应标头由我们依据真实响应体重新决定，不能原样透传（否则压缩方式 / 长度与实际体不符） */
const STRIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length"]);

/** 204 / 304 按规范不允许带响应体，构造 Response 时必须传 null */
const BODYLESS_STATUS = new Set([204, 304]);

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  if (!UPSTREAM) {
    return Response.json(
      {
        error: "supabase_proxy_not_configured",
        message:
          "未配置 NEXT_PUBLIC_SUPABASE_URL，反向代理无法工作。请在部署环境（含 Builds 作用域）补齐后重新部署。",
      },
      { status: 500 }
    );
  }

  const { path } = await ctx.params;
  const incoming = new URL(req.url);
  const target = new URL(`${UPSTREAM}/${path.join("/")}`);
  target.search = incoming.search;

  // ---- 请求标头规范化 ----
  const headers = new Headers(req.headers);
  // 必须删除：否则上游收到的是本站 Host（xxx.netlify.app），Supabase 网关会按错误主机路由。
  // 交给 undici 依据 target 重新生成正确的 Host。
  headers.delete("host");
  // 必须删除：要求上游返回未压缩内容。这样响应体与 `Content-Encoding` 一定自洽，
  // 不会出现「中间层改写编码、下游按旧编码解码」的经典错位。
  headers.delete("accept-encoding");
  // 必须删除：请求体可能被重新组装，长度交给 fetch 依据实际 body 重新计算。
  headers.delete("content-length");
  for (const name of HOP_BY_HOP) headers.delete(name);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  // 必须用 arrayBuffer() 读取原始字节再转发。
  // 直接透传 request.body 流在 App Router 下会缺标头 / 长度信息，容易 500。
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      // 不自动跟随：Supabase 的 3xx 需要原样交还给客户端
      redirect: "manual",
      cache: "no-store",
    });
  } catch (err) {
    // 网络层失败时给出结构化诊断，避免再次出现无法定位的黑盒 500
    return Response.json(
      {
        error: "supabase_upstream_unreachable",
        target: `${target.origin}${target.pathname}`,
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // ---- 响应标头回传 ----
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || STRIP_RESPONSE_HEADERS.has(lower)) return;
    out.set(key, value);
  });

  // Set-Cookie 可能有多条，Headers 的 forEach 会合并/覆盖，必须单独取数组逐个追加
  const rawHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = typeof rawHeaders.getSetCookie === "function" ? rawHeaders.getSetCookie() : [];
  if (setCookies.length > 0) {
    out.delete("set-cookie");
    for (const cookie of setCookies) out.append("set-cookie", cookie);
  }

  const responseBody = BODYLESS_STATUS.has(upstream.status) ? null : upstream.body;

  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;

// 代理必须逐请求实时处理：禁止任何静态化 / 数据缓存
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
