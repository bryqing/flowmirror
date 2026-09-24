"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Dices, Loader2, Pencil, RefreshCw, Sparkles, Sunrise, X } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { anchorRepo, dateLabel, localDateKey } from "@/lib/anchor-repository";
import { useAiStream } from "@/lib/use-ai-stream";
import type { MorningAnchorEntry } from "@/lib/types";

/**
 * 晨间心锚（Morning Anchor）
 * - 每日一条，按本地日期 key（YYYY-MM-DD）读取/保存
 * - 无记录时挂载后自动调用 AI 凝练（依据昨日之镜 + 今日任务）
 * - 右上角提供「重 roll」「编辑」，支持手动改写后落库
 *
 * ⚠️ **不允许有任何写死的兜底文案。**
 * 早先版本在 AI 与存储都不可用时，会展示并**落库**一条预置心锚
 * （"不等状态，先动十分钟"），source 记为 `"seed"`。那是一条编出来的话，
 * 却和用户自己写的心锚长得一模一样 —— 用户会以为那是自己的今日锚点。
 * 现在改成：凝练不出来就诚实地空着，给一个明确的「生成今日心锚」按钮。
 *
 * 状态机（loadState）：
 *   "idle"     → 尚未开始（SSR / 未挂载）
 *   "loading"  → 正在读取本地/远程记录
 *   "generating" → 正在调用 AI 凝练
 *   "ready"    → 已有心锚可展示
 *   "error"    → 读取或凝练失败，展示空态 + 重试入口
 */

type LoadState = "idle" | "loading" | "generating" | "ready" | "error";

export function MorningAnchor() {
  const { tasks, pushToast } = useFlow();

  // 挂载保护：日期标签含 new Date()，SSR 与客户端可能跨日/跨时区 → 先渲染占位
  const [mounted, setMounted] = useState(false);
  const [dateKey, setDateKey] = useState("");
  const [label, setLabel] = useState("");
  const [anchor, setAnchor] = useState<MorningAnchorEntry | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftSlogan, setDraftSlogan] = useState("");
  const [draftAction, setDraftAction] = useState("");
  const [tip, setTip] = useState<string | null>(null);

  // 是否已成功完成过「读取 + 生成」流程（成功后才置位，失败可重试）
  const bootstrapRef = useRef(false);
  // 防止重复并发触发（比 boolean 标记更可靠，卸载后也能感知）
  const inFlightRef = useRef(false);
  const { send, streaming, stop } = useAiStream("/api/ai/morning-anchor");

  const loading = loadState === "loading" || loadState === "generating";

  /** 组装 AI 输入：昨日未完成任务 / 黑洞时长 / 踩坑教训 */
  const buildContext = useCallback(
    (key: string, labelText: string) => {
      const unfinished = tasks
        .filter((t) => t.status === "pending" || t.status === "in-progress")
        .map((t) => t.title);
      const blackholeTasks = tasks.filter((t) => t.category === "blackhole");
      const blackholeMinutes = blackholeTasks.reduce(
        (sum, t) => sum + (t.actualDuration ?? t.blackholeMinutes ?? t.plannedDuration ?? 0),
        0,
      );
      const lessons = tasks.flatMap((t) =>
        t.pitfalls.map((p) => ({ taskTitle: t.title, text: p })),
      );
      const now = new Date();
      return {
        date: key,
        yesterdayUnfinished: unfinished,
        blackholeMinutes,
        lessons,
        now: `${labelText} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      };
    },
    [tasks],
  );

  /** 解析 AI 返回的 JSON（容错：剥 ```json 包裹 + 截取首尾花括号） */
  const parseAnchor = (raw: string): { slogan: string; action: string } | null => {
    if (!raw) return null;
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s === -1 || e <= s) return null;
    try {
      const obj = JSON.parse(cleaned.slice(s, e + 1)) as Record<string, unknown>;
      const slogan = String(obj.slogan ?? "").trim();
      const action = String(obj.action ?? "").trim();
      if (!slogan) return null;
      return { slogan, action };
    } catch {
      return null;
    }
  };

  /**
   * 凝练并保存当日心锚。**AI 没给出有效内容时什么都不做** ——
   * 既不展示、也不落库，把空态留给界面（宁可空白，也不要编一句给用户看）。
   */
  const generateWith = useCallback(
    async (key: string, labelText: string): Promise<boolean> => {
      if (!key) return false;
      setLoadState("generating");
      setErrMsg(null);
      setTip(null);

      // —— 调用 AI：拿不到有效内容就直接进入错误态，没有兜底文案 ——
      let parsed: { slogan: string; action: string } | null = null;
      try {
        const full = await send(buildContext(key, labelText));
        parsed = parseAnchor(full);
      } catch (e) {
        console.warn("[FlowMirror] 心锚 AI 生成异常：", e);
      }

      if (!parsed) {
        // 置位引导标记：失败后**不自动重试**（否则任务每次改动都会再打一次 AI），
        // 把重试权交给用户手上的按钮。
        bootstrapRef.current = true;
        setLoadState("error");
        setErrMsg("AI 未能凝练出今日心锚，可点下方按钮重新生成，或自己写一句");
        pushToast("心锚凝练未返回有效内容，已保留空态", "warn");
        return false;
      }

      // —— 落库（失败也不影响展示，用内存态先把结果呈现出来）——
      let saved: MorningAnchorEntry | null = null;
      try {
        saved = await anchorRepo.save(key, parsed.slogan, parsed.action, "ai");
      } catch (e) {
        console.warn("[FlowMirror] 心锚落库异常：", e);
      }

      const entry: MorningAnchorEntry = saved ?? {
        id: `local-${key}`,
        date: key,
        slogan: parsed.slogan,
        action: parsed.action,
        source: "ai",
        createdAt: new Date().toISOString(),
      };

      setAnchor(entry);
      setLoadState("ready");
      bootstrapRef.current = true;
      setTip(saved ? null : "已展示心锚（本地暂存，云端未同步）");
      return true;
    },
    [send, buildContext, pushToast],
  );

  /** 「重 roll」：重新凝练当日心锚 */
  const regenerate = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void generateWith(dateKey, label).finally(() => {
      inFlightRef.current = false;
    });
  }, [generateWith, dateKey, label]);

  /** 手动重试（错误态按钮） */
  const retry = useCallback(() => {
    bootstrapRef.current = false;
    regenerate();
  }, [regenerate]);

  // ---- 挂载：解析日期（含跨日兜底）----
  useEffect(() => {
    const now = new Date();
    const key = localDateKey(now);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDateKey(key);
    setLabel(dateLabel(now));
    setMounted(true);
    // 若页面跨过零点，自动切到新的一天
    const timer = setInterval(() => {
      const k = localDateKey(new Date());
      setDateKey((prev) => (prev === k ? prev : k));
      setLabel((prev) => {
        const next = dateLabel(new Date());
        return prev === next ? prev : next;
      });
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  // ---- 启动引导：读取当日心锚，无则自动凝练 ----
  // 注意：成功后才把 bootstrapRef 置为 true；任何失败都会释放，允许下次重试。
  useEffect(() => {
    if (!dateKey || bootstrapRef.current) return;
    let cancelled = false;

    (async () => {
      setLoadState("loading");
      setErrMsg(null);

      // 1) 先尝试读取已有记录（读失败不阻断，继续走生成）
      let existing: MorningAnchorEntry | null = null;
      try {
        existing = await anchorRepo.fetchByDate(dateKey);
      } catch (e) {
        console.warn("[FlowMirror] 读取心锚异常，转入生成：", e);
      }
      if (cancelled) return;

      if (existing) {
        setAnchor(existing);
        setLoadState("ready");
        bootstrapRef.current = true;
        return;
      }

      /**
       * 2) 无记录：**只有当天确实有内容可依据时才自动凝练**。
       *
       * 完全空白的一天（一条任务都没有、也没有任何复盘）不该被"自动拼凑"出
       * 一条心锚 —— 那等于系统替用户编了一句他从没写过的今日方针，
       * 和早先写死的预置心锚是同一类问题，只是换成了 AI 来编（`buildContext`
       * 此时送过去的全是空数组，模型只能凭空发挥）。
       *
       * 所以这里停在纯净空态，把决定权交给用户：下方备有「生成今日心锚」
       * 与「自己写」两条出口，点一下照样能拿到 AI 凝练的结果。
       *
       * ⚠️ 刻意**不置** `bootstrapRef`：任务稍后才从本地快照/云端加载进来时，
       * 本 effect 会因 `tasks` 变化重跑，那时数据齐了再自动凝练。
       */
      if (tasks.length === 0) {
        setLoadState("ready");
        return;
      }
      if (cancelled) return;
      await generateWith(dateKey, dateLabel(new Date()));
    })();

    return () => {
      cancelled = true;
    };
  }, [dateKey, generateWith, tasks]);

  const startEdit = () => {
    if (!anchor) return;
    setDraftSlogan(anchor.slogan);
    setDraftAction(anchor.action);
    setEditing(true);
    setTip(null);
  };

  const saveEdit = async () => {
    const slogan = draftSlogan.trim();
    const action = draftAction.trim();
    if (!slogan) {
      setTip("大字心锚不能为空");
      return;
    }
    setLoadState("loading");
    let ok = false;
    try {
      ok = Boolean(await anchorRepo.save(dateKey, slogan, action, "user"));
    } catch (e) {
      console.warn("[FlowMirror] 保存心锚异常：", e);
    }
    setLoadState("ready");

    // 即使落库失败也先展示用户输入，避免操作「看起来没反应」
    setAnchor((prev) => ({
      id: prev?.id ?? `local-${dateKey}`,
      date: dateKey,
      slogan,
      action,
      source: "user",
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    }));
    setEditing(false);
    setTip(ok ? "已保存你的心锚" : "已更新本页显示，云端暂未同步");
    if (!ok) pushToast("心锚未能同步到云端，已先在本页保存", "warn");
  };

  const displaySlogan = anchor?.slogan ?? "";
  const displayAction = anchor?.action ?? "";
  const showSkeleton = loadState === "loading" && !displaySlogan;
  const showGenerating = loadState === "generating" && !displaySlogan;

  return (
    <section className="glass animate-fade-up group relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-10 -top-14 size-44 rounded-full bg-cat-deep/[0.07] blur-3xl" />

      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-cat-deep/20 bg-cat-deep/10">
          <Sunrise className={cnIcon(loadState)} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-subtle-foreground">
              Morning Anchor · {mounted ? label : "…"}
            </p>

            {/* 轻量操作区：悬停/聚焦时显现，避免常驻干扰 */}
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
              {editing ? (
                <>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={saveEdit}
                    disabled={loading}
                    title="保存"
                  >
                    {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setTip(null);
                    }}
                    disabled={loading}
                    title="取消"
                  >
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={regenerate}
                    disabled={loading}
                    title="重 roll 一条新心锚"
                  >
                    {loading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Dices className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={startEdit}
                    disabled={loading || !anchor}
                    title="手动编辑"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>

          {editing ? (
            <div className="mt-2.5 flex flex-col gap-2">
              <Input
                value={draftSlogan}
                onChange={(e) => setDraftSlogan(e.target.value)}
                placeholder="大字心锚（≤15 字，动作断言）"
                maxLength={24}
                className="h-9 text-sm"
              />
              <Textarea
                value={draftAction}
                onChange={(e) => setDraftAction(e.target.value)}
                placeholder="小字注解：昨日卡点 + 今日几点前做什么"
                maxLength={80}
                className="min-h-[60px] text-xs"
              />
            </div>
          ) : showSkeleton ? (
            /* 读取中：微光骨架屏 */
            <div className="mt-2.5 flex flex-col gap-2" aria-busy="true" aria-live="polite">
              <div className="skeleton-line h-6 w-3/4 rounded-lg" />
              <div className="skeleton-line h-3 w-full rounded-md" />
              <p className="text-[11px] text-subtle-foreground">正在读取今日心锚…</p>
            </div>
          ) : showGenerating ? (
            /* 生成中：微光骨架屏 + 明确文案 */
            <div className="mt-2.5 flex flex-col gap-2" aria-busy="true" aria-live="polite">
              <div className="skeleton-line h-6 w-2/3 rounded-lg" />
              <div className="skeleton-line h-3 w-full rounded-md" />
              <p className="flex items-center gap-1.5 text-[11px] text-cat-deep/80">
                <Loader2 className="size-3 animate-spin" />
                正在凝练今日心锚…
              </p>
            </div>
          ) : displaySlogan ? (
            <>
              <h2 className="mt-1.5 text-lg font-light leading-snug tracking-tight sm:text-xl">
                {displaySlogan}
              </h2>
              {displayAction && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {displayAction}
                </p>
              )}
            </>
          ) : (
            /* 纯净空态：没有心锚就不摆任何预设文案，只给两条出口 */
            <div className="mt-2.5 flex flex-col gap-2.5" data-anchor-empty>
              <p className="text-sm font-light text-slate-500">今日还没有心锚</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                让 AI 依据昨日之镜与今日任务凝练一条，或者自己写一句今天要守住的动作。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  data-anchor-generate
                  onClick={regenerate}
                  disabled={loading}
                  className="border-cat-deep/30 text-cat-deep hover:bg-cat-deep/10"
                >
                  {loading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  生成今日心锚
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setDraftSlogan("");
                    setDraftAction("");
                    setEditing(true);
                    setTip(null);
                  }}
                  disabled={loading}
                >
                  <Pencil className="size-3" />
                  自己写
                </Button>
              </div>
            </div>
          )}

          {/* 提示 / 错误行 */}
          {errMsg && !editing && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-candle/90">
              <AlertTriangle className="size-3 shrink-0" />
              <span>{errMsg}</span>
            </div>
          )}
          {tip && !editing && <p className="mt-2 text-[11px] text-cat-deep/80">{tip}</p>}

          {/* 失败态重试入口：空态里已经有「生成今日心锚」，这里只服务于"已有内容但刷新失败" */}
          {loadState === "error" && !editing && displaySlogan && (
            <Button
              size="xs"
              variant="outline"
              onClick={retry}
              disabled={loading}
              className="mt-2 border-cat-deep/30 text-cat-deep hover:bg-cat-deep/10"
            >
              <RefreshCw className="size-3" />
              重新凝练
            </Button>
          )}
        </div>
      </div>

      {streaming && (
        <button
          type="button"
          onClick={stop}
          className="absolute bottom-2.5 right-3 text-[11px] text-subtle-foreground transition-colors hover:text-foreground"
        >
          停止生成
        </button>
      )}
    </section>
  );
}

/** 图标态：加载/生成时旋转，其余保持常态 */
function cnIcon(state: LoadState): string {
  return state === "loading" || state === "generating"
    ? "size-4 text-cat-deep animate-pulse"
    : "size-4 text-cat-deep";
}
