/**
 * Netlify 构建阶段：把 netlify.toml 中的 Supabase 代理占位符替换成真实地址。
 *
 * 为什么需要这一步：
 *   Netlify **不支持** 在 netlify.toml 中插值环境变量（`to = "$VAR"` 无效，官方文档明确说明）。
 *   但官方同时给出推荐做法 —— `[[redirects]]` / `[[headers]]` 两段是在**构建完成之后**才被读取的，
 *   因此可以在构建命令里先把占位符替换掉。
 *
 * 为什么要用 Netlify 原生 redirects 而不是只依赖 next.config.ts 的 rewrites：
 *   Netlify 在走 next.config 的 rewrites 代理时会改写 `Content-Encoding` 响应头，
 *   导致上游返回的压缩内容无法被浏览器正确解码（社区已有明确记录），
 *   表现为 Supabase 请求「连得上但解析失败」。改用 Netlify 原生代理则不受影响。
 *   两者并存时，Netlify 原生规则优先级更高 → 线上走原生代理；
 *   本地 `next start` 或其他平台则回退到 next.config.ts 的 rewrites，行为一致。
 *
 * 失败策略：任何异常都只告警、不中断构建 —— 缺少变量时自动退回 next.config.ts 的 rewrites 代理。
 */

import { readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER = "__SUPABASE_PROXY_TARGET__";
const TOML_FILE = "netlify.toml";

const target = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

if (!target) {
  console.warn(
    "[FlowMirror] 未设置 NEXT_PUBLIC_SUPABASE_URL，跳过 Netlify 代理注入。" +
      "线上将退回 next.config.ts 的 rewrites 代理（仍可用，但可能受 Content-Encoding 改写影响）。"
  );
  process.exit(0);
}

try {
  const source = readFileSync(TOML_FILE, "utf8");
  if (!source.includes(PLACEHOLDER)) {
    console.warn(`[FlowMirror] ${TOML_FILE} 中未找到占位符 ${PLACEHOLDER}，跳过注入（可能已注入过）。`);
    process.exit(0);
  }
  writeFileSync(TOML_FILE, source.split(PLACEHOLDER).join(target), "utf8");
  console.log(`[FlowMirror] 已注入 Supabase 反向代理目标：${target}`);
} catch (err) {
  console.warn("[FlowMirror] 注入 Netlify 代理目标失败（不中断构建）：", err);
}
