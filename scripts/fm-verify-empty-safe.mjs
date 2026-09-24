/**
 * FlowMirror 空数据 + 脏数据 渲染安全性验证（生产构建）
 *
 * 三个场景，逐条即时打印断言：
 *   A. 全新访客（localStorage 为空 → tasks === []）→ 必须渲染纯净空白引导态，console.error 严格 0
 *   B. 历史脏数据（缺数组字段 / 非法 status / 非法 category / 灵感缺 tags）
 *      → 页面必须照常渲染，绝不整站白屏
 *   C. 把 JS 全部阻断 → 启动看门狗**仍然**要报警（证明改了计时方式后判据没被削弱）
 *
 * 用法：node scripts/fm-verify-empty-safe.mjs [url]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:3200";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9335;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}  →  ${JSON.stringify(actual)}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}  →  实际 ${JSON.stringify(actual)}（期望 ${typeof expected === "function" ? expected.toString() : JSON.stringify(expected)}）`);
  }
  return ok;
}

const HOOK = `
window.__fmErrors = [];
window.__fmConsole = [];
(function(){
  window.addEventListener('error', function(e){
    window.__fmErrors.push({
      kind: 'error',
      message: e.message || ('resource-error: ' + (e.target && (e.target.src || e.target.href))),
      stack: (e.error && e.error.stack) ? String(e.error.stack) : null
    });
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    window.__fmErrors.push({
      kind: 'rejection',
      message: r && r.message ? String(r.message) : String(r),
      stack: (r && r.stack) ? String(r.stack) : null
    });
  });
  ['warn','error'].forEach(function(level){
    var orig = console[level];
    console[level] = function(){
      var args = Array.prototype.slice.call(arguments);
      window.__fmConsole.push({
        level: level,
        text: args.map(function(a){
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch(e){ return String(a); }
        }).join(' ').slice(0, 400)
      });
      orig.apply(console, args);
    };
  });
})();
`;

/**
 * 脏数据种子：故意构造三种历史遗留形状
 *   1. done 任务但完全没有数组字段，且非法 status
 *   2. 非法 category
 *   3. microReviews 里的子对象缺 blockerTags / lessonTags
 */
const DIRTY_SEED = `
(function(){
  try {
    var d = new Date();
    var key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    localStorage.setItem('flowmirror:cache-schema', '3');
    localStorage.setItem('flowmirror:tasks:snapshot:' + key, JSON.stringify([
      { id: 'task-dirty-1', title: '历史遗留：缺全部数组字段', status: 'done', category: 'deep-work',
        scheduledTime: '09:00', plannedDuration: 50, createdAt: '2026-09-01T01:00:00.000Z' },
      { id: 'task-dirty-2', title: '历史遗留：非法分类', status: 'weird-status', category: 'unknown-cat',
        scheduledTime: '10:00', plannedDuration: 30, timeSlices: null, microReviews: undefined,
        insights: null, sops: null, pitfalls: null, createdAt: '2026-09-01T02:00:00.000Z' },
      { id: 'task-dirty-3', title: '历史遗留：微复盘缺子字段', status: 'done', category: 'chore',
        timeSlices: [{ start: '11:00', end: '12:00', label: 'x' }, null],
        microReviews: [{ id: 'r1', createdAt: '11:30', note: '卡在开场' }],
        insights: [], sops: [], pitfalls: [], createdAt: '2026-09-01T03:00:00.000Z' }
    ]));
    localStorage.setItem('flowmirror:tasks:backlog', JSON.stringify([
      { id: 'task-dirty-4', title: '池里脏任务', status: 'pending', category: 'rest', createdAt: '2026-09-01T04:00:00.000Z' }
    ]));
    localStorage.setItem('flowmirror:thoughts:snapshot', JSON.stringify([
      { id: 'th-1', content: '缺 tags 的灵感' }
    ]));
  } catch (e) { /* ignore */ }
})();
`;

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id != null && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
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

/** 每个场景一趟干净导航：先挂钩子 → 清 localStorage → 可选种子 → 导航 */
async function goto(cdp, { seed = null, blockJs = false, settle = 9000 } = {}) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  if (seed) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seed });

  await cdp.send("Network.setBlockedURLs", {
    urls: blockJs ? ["*/_next/static/chunks/*"] : [],
  });

  await cdp.eval("try{localStorage.clear()}catch(e){}");
  // 清完立刻写种子：下一次导航时钩子会在应用脚本之前把种子放回去
  if (seed) await cdp.eval(seed);
  cdp.send("Page.navigate", { url: BASE }).catch(() => {});
  await sleep(settle);
}

(async () => {
  const profile = mkdtempSync(join(tmpdir(), "fm-verify-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--window-size=1280,900",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const cdp = await connect();
    console.log(`目标：${BASE}（生产构建）`);

    /** 汇总一个场景的观测结果 */
    const observe = async () => ({
      mounted: await cdp.eval("Boolean(window.__fmAppMounted)"),
      watchdog: await cdp.eval("Boolean(document.getElementById('fm-boot-warning'))"),
      errors: (await cdp.eval("window.__fmErrors || []")) ?? [],
      warnErr: ((await cdp.eval("window.__fmConsole || []")) ?? []).filter((l) => l.level === "error"),
      warnings: ((await cdp.eval("window.__fmConsole || []")) ?? []).filter((l) => l.level === "warn"),
    });

    const reportErrors = (o) => {
      if (o.errors.length > 0) {
        console.log(`    ★ 未捕获异常 ${o.errors.length} 条：`);
        for (const e of o.errors.slice(0, 5)) {
          console.log(`      [${e.kind}] ${e.message}`);
          if (e.stack) console.log(`        ${e.stack.split("\n").slice(0, 6).join("\n        ")}`);
        }
      }
      if (o.warnErr.length > 0) {
        console.log(`    ★ console.error ${o.warnErr.length} 条：`);
        const seen = new Set();
        for (const l of o.warnErr) {
          const k = l.text.slice(0, 160);
          if (seen.has(k)) continue;
          seen.add(k);
          console.log(`      - ${k}`);
        }
      }
      // warning 不算失败，但如实打出来，便于确认应用没有在"悄悄降级"
      if (o.warnings.length > 0) {
        console.log(`    · console.warn ${o.warnings.length} 条：`);
        const seen = new Set();
        for (const l of o.warnings) {
          const k = l.text.slice(0, 160);
          if (seen.has(k)) continue;
          seen.add(k);
          console.log(`      - ${k}`);
        }
      }
    };

    // ================= A. 全新访客：tasks === [] =================
    console.log(`\n${"=".repeat(70)}\n场景 A · 全新访客（tasks = []）\n${"=".repeat(70)}`);
    await goto(cdp, { settle: 12000 });
    {
      const o = await observe();
      check("A1 React 已挂载", o.mounted, true);
      check("A2 未触发启动告警条", o.watchdog, false);
      check("A3 未捕获异常 = 0", o.errors.length, 0);
      check("A4 console.error = 0", o.warnErr.length, 0);
      check("A5 四象限容器齐备", await cdp.eval("document.querySelectorAll('[data-quadrant]').length"), 4);
      check("A6 四象限全部走空态占位", await cdp.eval("document.querySelectorAll('[data-quadrant-empty]').length"), 4);
      check(
        "A7 战局空态文案正确",
        await cdp.eval("document.body.innerText.includes('今日暂无安排，点击上方或下方添加')"),
        true
      );
      check("A8 待执行池空态文案正确", await cdp.eval(`(function(){
        // ⚠️ 五个板块是「常驻挂载 + hidden 显隐」，待执行池此刻 display:none，
        //    body.innerText 取不到它 —— 必须直接读那个占位节点的 textContent。
        var el = document.querySelector('[data-quadrant-empty="rest"]');
        return el ? el.textContent.includes('池子还空着') : false;
      })()`), true);
      check("A9 昨日之镜纯净空态出现", await cdp.eval("Boolean(document.querySelector('[data-mirror-empty]'))"), true);
      check("A10 页面无横向溢出", await cdp.eval("document.documentElement.scrollWidth <= window.innerWidth + 1"), true);
      reportErrors(o);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      const f = join(tmpdir(), "fm-verify-A-empty.png");
      writeFileSync(f, Buffer.from(shot.data, "base64"));
      console.log(`  截图：${f}`);
    }

    // ================= B. 脏数据 =================
    console.log(`\n${"=".repeat(70)}\n场景 B · 历史脏数据（缺数组字段 / 非法枚举 / 缺 tags）\n${"=".repeat(70)}`);
    await goto(cdp, { seed: DIRTY_SEED, settle: 12000 });
    {
      const o = await observe();
      check("B1 React 已挂载", o.mounted, true);
      check("B2 未触发启动告警条", o.watchdog, false);
      check("B3 未捕获异常 = 0", o.errors.length, 0);
      check("B4 console.error = 0", o.warnErr.length, 0);
      const cards = await cdp.eval("document.querySelectorAll('[data-task-card]').length");
      check("B5 脏任务仍被渲染出来（不是被丢掉）", cards, (v) => v >= 3);
      check("B6 无整站白屏（正文有内容）", await cdp.eval("(document.body.innerText||'').length"), (v) => v > 300);
      reportErrors(o);

      // 点开一条脏任务的详情抽屉 —— 抽屉里有最多的裸数组访问
      const opened = await cdp.eval(`(function(){
        var c = document.querySelector('[data-task-card]');
        if (!c) return 'no-card';
        c.click();
        return 'clicked';
      })()`);
      await sleep(1200);
      const o2 = await observe();
      check("B7 点击脏任务卡片成功", opened, "clicked");
      check("B8 详情抽屉打开后仍无未捕获异常", o2.errors.length, 0);
      check("B9 详情抽屉打开后仍无 console.error", o2.warnErr.length, 0);
      check("B10 详情抽屉确实渲染了内容", await cdp.eval("document.body.innerText.includes('战前锦囊')"), true);
      reportErrors(o2);
      const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
      const f2 = join(tmpdir(), "fm-verify-B-dirty.png");
      writeFileSync(f2, Buffer.from(shot2.data, "base64"));
      console.log(`  截图：${f2}`);
    }

    // ================= C. JS 被阻断 → 告警条必须仍然出现 =================
    console.log(`\n${"=".repeat(70)}\n场景 C · 阻断 JS 包（验证看门狗判据没被削弱）\n${"=".repeat(70)}`);
    await goto(cdp, { blockJs: true, settle: 14000 });
    {
      const o = await observe();
      check("C1 React 未挂载（JS 被阻断）", o.mounted, false);
      check("C2 启动告警条如实出现", o.watchdog, true);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`结果：PASS ${pass} / FAIL ${fail}`);
    console.log(`${"=".repeat(70)}`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    chrome.kill();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error("验证脚本失败：", e); process.exit(1); });
