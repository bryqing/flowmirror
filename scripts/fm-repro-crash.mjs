/**
 * FlowMirror 运行时崩溃复现器
 *
 * 用 CDP 直连真实 Chrome（headless），在**任何应用脚本执行之前**注入错误钩子，
 * 因此能抓到 React 渲染期抛出的真实堆栈 —— 这是定位「整页白屏」的唯一可靠手段：
 * 崩溃时 React 会卸载整棵树，界面上什么都不剩，无法从 DOM 反推原因。
 *
 * 两种场景分别复现：
 *   A. 全新访客（localStorage 为空 → tasks = []）
 *   B. 带着历史脏快照（任务缺 microReviews / timeSlices 等数组字段）
 *
 * 用法：node scripts/fm-repro-crash.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 加载前就挂上的钩子：把错误攒进 window.__fmErrors，供事后一次性取回 */
const ERROR_HOOK = `
window.__fmErrors = [];
window.__fmLogs = [];
(function(){
  function push(kind, payload){
    try { window.__fmErrors.push(Object.assign({ kind: kind, at: Date.now() }, payload)); } catch(e){}
  }
  window.addEventListener('error', function(e){
    push('error', {
      message: e.message,
      source: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: (e.error && e.error.stack) ? String(e.error.stack) : null
    });
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    push('unhandledrejection', {
      message: r && r.message ? String(r.message) : String(r),
      stack: (r && r.stack) ? String(r.stack) : null
    });
  });
  // React 的错误边界会吞掉异常只留 console.error，必须一并接住
  var origError = console.error;
  console.error = function(){
    var args = Array.prototype.slice.call(arguments);
    var text = args.map(function(a){
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch(e){ return String(a); }
    }).join(' ');
    window.__fmLogs.push({ level: 'error', text: text });
    origError.apply(console, args);
  };
  var origWarn = console.warn;
  console.warn = function(){
    var args = Array.prototype.slice.call(arguments);
    window.__fmLogs.push({ level: 'warn', text: args.map(String).join(' ') });
    origWarn.apply(console, args);
  };
})();
`;

/** 历史脏快照：缺 microReviews / timeSlices / pitfalls，模拟跨版本遗留记录 */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      return { __evalError: r.exceptionDetails.text ?? "eval failed" };
    }
    return r.result?.value;
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
        });
        return new Cdp(ws);
      }
    } catch {
      /* chrome 还没起来 */
    }
    await sleep(300);
  }
  throw new Error("无法连接 Chrome CDP");
}

async function runCase(cdp, name, seedScript) {
  console.log(`\n${"=".repeat(72)}\n场景 ${name}\n${"=".repeat(72)}`);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // 关键：钩子必须在任何应用代码之前生效
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: ERROR_HOOK });
  if (seedScript) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript });
  }

  await cdp.send("Network.clearBrowserCookies").catch(() => {});
  await cdp.eval(`try{localStorage.clear()}catch(e){}`);
  await cdp.send("Page.navigate", { url: BASE });
  await sleep(9000); // 等 React 挂载 + 让看门狗（9s）有机会触发

  const mounted = await cdp.eval("Boolean(window.__fmAppMounted)");
  const watchdog = await cdp.eval("Boolean(document.getElementById('fm-boot-warning'))");
  const errors = (await cdp.eval("window.__fmErrors || []")) ?? [];
  const logs = (await cdp.eval("window.__fmLogs || []")) ?? [];
  const bodyLen = await cdp.eval("(document.body.innerText||'').length");
  const quadrants = await cdp.eval(
    "document.querySelectorAll('[data-quadrant]').length"
  );

  console.log(`React 已挂载      : ${mounted}`);
  console.log(`兜底告警条出现    : ${watchdog}`);
  console.log(`body 文本长度     : ${bodyLen}`);
  console.log(`[data-quadrant] 数: ${quadrants}`);

  const realErrors = errors.filter((e) => e.kind === "error" || e.kind === "unhandledrejection");
  if (realErrors.length === 0) {
    console.log("未捕获异常        : 无");
  } else {
    console.log(`\n★ 未捕获异常 ${realErrors.length} 条：`);
    for (const e of realErrors) {
      console.log(`  [${e.kind}] ${e.message}`);
      console.log(`    source: ${e.source}:${e.line}:${e.col}`);
      if (e.stack) console.log(`    stack:\n${e.stack.split("\n").slice(0, 12).join("\n")}`);
    }
  }

  const consoleErrors = logs.filter((l) => l.level === "error");
  if (consoleErrors.length > 0) {
    console.log(`\n★ console.error ${consoleErrors.length} 条（去重后）：`);
    const seen = new Set();
    for (const l of consoleErrors) {
      const key = l.text.slice(0, 220);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  - ${key.replace(/\n/g, "\n    ")}`);
    }
  }

  if (realErrors.length > 0 || consoleErrors.length > 0 || !mounted || watchdog) {
    await cdp.send("Page.captureScreenshot", { format: "png" }).then(async (r) => {
      const { writeFileSync } = await import("node:fs");
      const file = join(tmpdir(), `fm-crash-${name.replace(/[^\w]/g, "_")}.png`);
      writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(`\n截图已保存：${file}`);
    });
  }

  return { mounted, watchdog, realErrors, consoleErrors, bodyLen, quadrants };
}

(async () => {
  const profile = mkdtempSync(join(tmpdir(), "fm-chrome-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    const cdp = await connect();
    console.log(`已连接 Chrome，目标：${BASE}`);

    const a = await runCase(cdp, "A-全新访客-tasks为空", null);
    const b = await runCase(
      cdp,
      "B-历史脏快照-缺数组字段",
      `try{localStorage.setItem('flowmirror:cache-schema','3');}catch(e){}`
    );

    console.log(`\n${"=".repeat(72)}\n结论\n${"=".repeat(72)}`);
    console.log(`A: 挂载=${a.mounted} 兜底条=${a.watchdog} 未捕获异常=${a.realErrors.length} console.error=${a.consoleErrors.length}`);
    console.log(`B: 挂载=${b.mounted} 兜底条=${b.watchdog} 未捕获异常=${b.realErrors.length} console.error=${b.consoleErrors.length}`);
  } finally {
    chrome.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* windows 文件锁，忽略 */
    }
  }
})().catch((err) => {
  console.error("复现脚本失败：", err);
  process.exit(1);
});
