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
 * 缺失变量时：**整段代理规则会被注释掉**，而不是留下一个 `to = "__SUPABASE_PROXY_TARGET__/:splat"`
 *   的坏规则（那会让 /api/supabase/* 变成一个指向不存在路径的同站代理）。
 *   此时线上退化为「无代理」，由 next.config.ts 的 rewrites 兜底（若该变量也缺失则完全不代理，
 *   前端回到 mock/本地模式 —— 因为 Supabase 本身就没配置）。
 *
 * 任何异常都只告警、不中断构建。
 */

import { readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER = "__SUPABASE_PROXY_TARGET__";
const TOML_FILE = "netlify.toml";
const BLOCK_HEADER = "[[redirects]]";

const target = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

try {
  const lines = readFileSync(TOML_FILE, "utf8").split("\n");
  const hitIndex = lines.findIndex((line) => line.includes(PLACEHOLDER));

  if (hitIndex === -1) {
    console.log(`[FlowMirror] ${TOML_FILE} 中未找到代理占位符，无需注入（可能已注入过）。`);
    process.exit(0);
  }

  if (!target) {
    // 变量缺失：注释掉整个 [[redirects]] 块，避免留下坏规则。
    let start = hitIndex;
    while (start >= 0 && lines[start].trim() !== BLOCK_HEADER) start--;
    if (start === -1) start = hitIndex; // 兜底：至少注释掉含占位符的那一行

    let end = start + 1;
    while (end < lines.length && !/^\[/.test(lines[end])) end++;

    for (let i = start; i < end; i++) {
      if (lines[i].trim() !== "") lines[i] = `# ${lines[i]}`;
    }
    lines.splice(
      start,
      0,
      "# ⚠️ 未检测到 NEXT_PUBLIC_SUPABASE_URL，已自动停用上面的 Supabase 反向代理规则。",
      "#    请在 Netlify → Site configuration → Environment variables 中补齐该变量",
      "#    （作用域需包含 Builds），然后重新部署。"
    );

    writeFileSync(TOML_FILE, lines.join("\n"), "utf8");
    console.warn(
      "[FlowMirror] 未设置 NEXT_PUBLIC_SUPABASE_URL，已停用 Netlify 代理规则。" +
        "线上将退回 next.config.ts 的 rewrites 代理。"
    );
    process.exit(0);
  }

  lines[hitIndex] = lines[hitIndex].split(PLACEHOLDER).join(target);
  writeFileSync(TOML_FILE, lines.join("\n"), "utf8");
  console.log(`[FlowMirror] 已注入 Supabase 反向代理目标：${target}`);
} catch (err) {
  console.warn("[FlowMirror] 注入 Netlify 代理目标失败（不中断构建）：", err);
}
