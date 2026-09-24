/**
 * FlowMirror 线上诊断：为什么 React 没接管？
 *
 * 逐秒观察 window.__fmAppMounted，并记录所有网络请求的状态码，
 * 用来区分三种完全不同的病因：
 *   1) JS 包请求失败（404 / 网络错误）→ 资源问题
 *   2) JS 包加载成功但执行期抛错       → 代码问题（会看到 uncaught exception）
 *   3) 一切正常只是太慢                 → 看门狗超时阈值问题
 *
 * 用法：node scripts/fm-diag-boot.mjs [url] [waitSeconds]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "https://jocular-pony-b41da7.netlify.app";
const WAIT = Number(process.argv[3] ?? 30);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9334;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HOOK = `
window.__fmErrors = [];
window.__fmMarks = [];
window.__fmConsole = [];
(function(){
  window.__fmMarks.push({ t: Date.now(), what: 'hook-installed' });
  window.addEventListener('error', function(e){
    window.__fmErrors.push({
      kind: 'error', t: Date.now(),
      message: e.message || ('resource-error: ' + (e.target && (e.target.src || e.target.href))),
      stack: (e.error && e.error.stack) ? String(e.error.stack) : null
    });
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    window.__fmErrors.push({
      kind: 'rejection', t: Date.now(),
      message: r && r.message ? String(r.message) : String(r),
      stack: (r && r.stack) ? String(r.stack) : null
    });
  });
  ['log','info','warn','error'].forEach(function(level){
    var orig = console[level];
    console[level] = function(){
      var args = Array.prototype.slice.call(arguments);
      window.__fmConsole.push({
        level: level, t: Date.now(),
        text: args.map(function(a){
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch(e){ return String(a); }
        }).join(' ').slice(0, 500)
      });
      orig.apply(console, args);
    };
  });
})();
`;

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.onEvent?.(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); }
      }, 60000);
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? { __evalError: r.exceptionDetails.text } : r.result?.value;
  }
}

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
        });
        return new Cdp(ws);
      }
    } catch { /* wait */ }
    await sleep(300);
  }
  throw new Error("CDP 连接失败");
}

(async () => {
  const profile = mkdtempSync(join(tmpdir(), "fm-diag-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking",
    "--window-size=1280,900",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const cdp = await connect();
    const requests = [];
    const failed = [];
    cdp.onEvent = (msg) => {
      if (msg.method === "Network.responseReceived") {
        const r = msg.params.response;
        requests.push({ url: r.url, status: r.status, mime: r.mimeType, fromSW: !!r.fromServiceWorker });
      } else if (msg.method === "Network.loadingFailed") {
        failed.push({ err: msg.params.errorText, blocked: msg.params.blockedReason ?? null });
      }
    };

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });

    const t0 = Date.now();
    // 不 await：线上导航本身可能超过 60s
    cdp.send("Page.navigate", { url: BASE }).catch(() => {});
    await sleep(1500);

    // 逐秒观察挂载状态
    console.log(`导航目标：${BASE}\n逐秒观察 window.__fmAppMounted（看门狗阈值 9s）：`);
    const timeline = [];
    for (let i = 0; i < WAIT; i++) {
      const m = await cdp.eval("Boolean(window.__fmAppMounted)").catch(() => "n/a");
      const ready = await cdp.eval("document.readyState").catch(() => "?");
      const t = ((Date.now() - t0) / 1000).toFixed(1);
      timeline.push({ t, mounted: m, ready });
      if (i % 2 === 0 || m === true) console.log(`  +${t}s  mounted=${m}  readyState=${ready}`);
      if (m === true) break;
      await sleep(1000);
    }

    const errors = (await cdp.eval("window.__fmErrors || []")) ?? [];
    const logs = (await cdp.eval("window.__fmConsole || []")) ?? [];
    const watchdog = await cdp.eval("Boolean(document.getElementById('fm-boot-warning'))");

    console.log(`\n兜底告警条存在：${watchdog}`);
    console.log(`\n未捕获异常 / Promise rejection：${errors.length} 条`);
    for (const e of errors) console.log(`  [${e.kind}] ${e.message}\n    ${(e.stack ?? "").split("\n").slice(0, 8).join("\n    ")}`);

    console.log(`\nconsole 输出：${logs.length} 条`);
    const seen = new Set();
    for (const l of logs) {
      const k = `${l.level}|${l.text.slice(0, 160)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  [${l.level}] ${l.text.slice(0, 300)}`);
    }

    console.log(`\n网络请求：${requests.length} 条；失败：${failed.length} 条`);
    const bad = requests.filter((r) => r.status >= 400);
    if (bad.length) {
      console.log("  ★ 非 2xx 请求：");
      for (const r of bad) console.log(`    ${r.status}  ${r.url}`);
    }
    console.log("  静态资源（/_next/static/）：");
    for (const r of requests.filter((r) => r.url.includes("/_next/static/"))) {
      console.log(`    ${r.status}  ${r.fromSW ? "[SW] " : ""}${r.url.replace(BASE, "").slice(0, 110)}`);
    }
    if (failed.length) {
      console.log("  ★ 加载失败的请求：");
      for (const f of failed.slice(0, 20)) console.log(`    ${f.err}  blocked=${f.blocked}`);
    }

    await cdp.send("Page.captureScreenshot", { format: "png" }).then(async (r) => {
      const { writeFileSync } = await import("node:fs");
      const file = join(tmpdir(), "fm-diag-boot.png");
      writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(`\n截图：${file}`);
    }).catch(() => {});
  } finally {
    chrome.kill();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error("诊断脚本失败：", e); process.exit(1); });
