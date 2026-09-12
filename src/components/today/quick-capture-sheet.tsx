"use client";

import { useCallback, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Mic,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DarkSelect, type DarkSelectOption } from "@/components/ui/dark-select";
import { useSpeech } from "@/lib/use-speech";
import {
  CATEGORY_META,
  QUADRANT_META,
  QUADRANT_ORDER,
  PRIORITY_META,
  coerceQuadrant,
  isTaskPriority,
  quadrantToCategory,
  type Quadrant,
  type TaskPriority,
} from "@/lib/types";
import { cn, uid } from "@/lib/utils";

/**
 * AI 战局速记 / 智能拆解
 *
 * 三步流程（显式状态机，避免多个布尔值互相打架）：
 *   input    输入阶段 —— 大文本域，支持粘贴或语音转写
 *   parsing  解析阶段 —— 骨架屏 + 请求 /api/ai/parse-tasks
 *   confirm  确认阶段 —— 逐条改标题 / 换象限 / 调优先级 / 删除，再批量入库
 *
 * 降级策略（与项目「三层降级、绝不留白」约定一致）：
 *   AI 失败 → 按行/句本地拆分 + 提示手动归类 → 仍为空则回到输入态并给出错误提示。
 *   入库沿用 flow-context.addTasks：先乐观落界面，云端失败则排队补录。
 *
 * 复用 Sheet（React Portal 挂到 document.body），继承 ESC 关闭、遮罩关闭、
 * 背景滚动锁定与移动端底部 / 桌面端右侧的自适应布局。
 */

type Stage = "input" | "parsing" | "confirm";

/** 待确认任务（key 仅用于列表渲染与增删改定位） */
interface DraftTask {
  key: string;
  title: string;
  quadrant: Quadrant;
  priority: TaskPriority;
}

/** 优先级排序权重：高优先排前面，导入后看板内顺序即优先序 */
const PRIORITY_WEIGHT: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/** 象限下拉项：编号 + 名称，左侧带该象限的分类色点 */
const QUADRANT_OPTIONS: DarkSelectOption<Quadrant>[] = QUADRANT_ORDER.map((q) => ({
  value: q,
  label: `${q.toUpperCase()} ${QUADRANT_META[q].label}`,
  dot: CATEGORY_META[QUADRANT_META[q].category].dot,
}));

/** 优先级下拉项 */
const PRIORITY_OPTIONS: DarkSelectOption<TaskPriority>[] = (
  ["high", "medium", "low"] as TaskPriority[]
).map((p) => ({ value: p, label: `${PRIORITY_META[p].label}优先` }));

const PLACEHOLDER = `把脑子里盘旋的事一股脑倒进来，AI 会拆成任务并归入四象限：

明天上午十点前要交的方案初稿，还要回客户那封询价邮件；
抽空把上个月报销整理了，另外想研究下竞品的新定价页；
晚上留半小时散步放松。`;

/** 行首的序号 / 项目符号前缀 */
const LIST_PREFIX = /^[\s\d.、,，)）\-·•*]+/;

/**
 * 本地降级拆分：AI 不可用时把长文本按句切开，交给用户手动归类。
 * 先按换行与句末标点切；若只切出一段（口述常见的一整句），再退一步按顿号/逗号切。
 */
function splitLocally(text: string): DraftTask[] {
  const strip = (s: string) => s.replace(LIST_PREFIX, "").trim();
  const coarse = text
    .split(/[\n\r；;。！!？?]+/)
    .map(strip)
    .filter((s) => s.length >= 2);
  const segments =
    coarse.length > 1
      ? coarse
      : text
          .split(/[，,、]+/)
          .map(strip)
          .filter((s) => s.length >= 2);

  return segments.slice(0, 20).map((title) => ({
    key: uid("draft"),
    title,
    quadrant: "q2" as Quadrant,
    priority: "medium" as TaskPriority,
  }));
}

/** 校验并归一化接口返回，任何脏数据都在这里被挡掉 */
function normalizeFromApi(data: unknown): DraftTask[] {
  const list = (data as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(list)) return [];
  const out: DraftTask[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    if (!title) continue;
    out.push({
      key: uid("draft"),
      title,
      quadrant: coerceQuadrant(row.quadrant) ?? "q3",
      priority: isTaskPriority(row.priority) ? row.priority : "medium",
    });
  }
  return out;
}

export function QuickCaptureSheet() {
  const { addTasks, pushToast } = useFlow();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("input");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<DraftTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // 防重入：DeepSeek 推理耗时不可控，重复点击会并发打两个请求
  const inFlight = useRef(false);

  const {
    supported: speechSupported,
    listening,
    error: speechError,
    start: startSpeech,
    stop: stopSpeech,
  } = useSpeech((transcript) => setText(transcript));

  const reset = useCallback(() => {
    setStage("input");
    setText("");
    setDrafts([]);
    setError(null);
    setImporting(false);
    setProgress({ done: 0, total: 0 });
  }, []);

  /** 打开时重置：避免退场动画期间界面闪回上一轮的确认列表 */
  const openSheet = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  const closeSheet = useCallback(() => {
    if (importing) return; // 导入中不允许中途关闭，避免状态错乱
    stopSpeech();
    setOpen(false);
  }, [importing, stopSpeech]);

  const parse = useCallback(async () => {
    const content = text.trim();
    if (content.length < 2 || inFlight.current) return;
    if (listening) stopSpeech();

    inFlight.current = true;
    setStage("parsing");
    setError(null);

    try {
      const res = await fetch("/api/ai/parse-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      const data = (await res.json().catch(() => null)) as
        | { tasks?: unknown; error?: string }
        | null;

      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      const parsed = normalizeFromApi(data);
      if (parsed.length === 0) {
        setStage("input");
        setError("这段内容里没识别出可执行的事项，再写具体一点试试。");
        return;
      }
      setDrafts(parsed);
      setStage("confirm");
    } catch (err) {
      console.warn("[FlowMirror] AI 速记解析失败，降级为本地拆分：", err);
      const fallback = splitLocally(content);
      if (fallback.length > 0) {
        setDrafts(fallback);
        setStage("confirm");
        pushToast("AI 解析失败，已按句子拆分，请手动确认分类", "warn");
      } else {
        setStage("input");
        setError("解析失败了，检查网络后重试，或先手动加两条。");
      }
    } finally {
      inFlight.current = false;
    }
  }, [text, listening, stopSpeech, pushToast]);

  const updateDraft = useCallback((key: string, patch: Partial<DraftTask>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const removeDraft = useCallback((key: string) => {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }, []);

  const addDraft = useCallback(() => {
    setDrafts((prev) => [
      ...prev,
      { key: uid("draft"), title: "", quadrant: "q2", priority: "medium" },
    ]);
  }, []);

  const confirmImport = useCallback(async () => {
    const items = drafts
      .filter((d) => d.title.trim().length > 0)
      .slice()
      .sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority])
      .map((d) => ({ title: d.title.trim(), category: quadrantToCategory(d.quadrant) }));

    if (items.length === 0 || importing) return;

    setImporting(true);
    setProgress({ done: 0, total: items.length });
    try {
      const count = await addTasks(items, (done, total) => setProgress({ done, total }));
      pushToast(`已导入 ${count} 项，看板已刷新`, "success");
      // 只关不重置：重置会发生在下次 openSheet()，
      // 否则退场动画的 320ms 内面板会闪成一张空表单
      setOpen(false);
    } catch {
      pushToast("导入失败，请重试", "danger");
    } finally {
      setImporting(false);
    }
  }, [drafts, importing, addTasks, pushToast]);

  const readyCount = drafts.filter((d) => d.title.trim().length > 0).length;

  return (
    <>
      {/* 入口按钮：看板顶部的主动作 */}
      <Button
        size="sm"
        onClick={openSheet}
        className="gap-1.5 border border-cat-deep/30 bg-cat-deep/12 text-cat-deep hover:bg-cat-deep/20"
      >
        <Wand2 className="size-3.5" />
        AI 速记
      </Button>

      <Sheet open={open} onClose={closeSheet} title="AI 战局速记 · 智能拆解">
        <div className="px-5 pb-5">
          {/* ---------------- 输入阶段 ---------------- */}
          {stage === "input" && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] leading-relaxed text-subtle-foreground">
                粘贴或说出今天要做的事，AI 会拆成任务并推荐象限。不会直接入库，确认后才写入看板。
              </p>

              <div className="relative">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={9}
                  maxLength={4000}
                  autoFocus
                  placeholder={PLACEHOLDER}
                  className="min-h-[184px] pr-11"
                />
                {speechSupported && (
                  <button
                    onClick={listening ? stopSpeech : startSpeech}
                    aria-label={listening ? "停止语音输入" : "语音输入"}
                    className={cn(
                      "absolute bottom-2.5 right-2.5 flex size-8 items-center justify-center rounded-lg transition-all",
                      listening
                        ? "bg-cat-blackhole/20 text-cat-blackhole"
                        : "bg-white/[0.07] text-muted-foreground hover:bg-cat-deep/20 hover:text-cat-deep"
                    )}
                  >
                    {listening && (
                      <span className="absolute inset-0 animate-ping rounded-lg bg-cat-blackhole/40" />
                    )}
                    <Mic className={cn("relative size-3.5", listening && "animate-pulse")} />
                  </button>
                )}
              </div>

              {listening && (
                <p className="flex items-center gap-1.5 text-[11px] text-cat-deep">
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-cat-deep" />
                  正在聆听… 说完点麦克风停止
                </p>
              )}
              {speechError && (
                <p className="text-[11px] text-cat-blackhole/85">{speechError}</p>
              )}
              {error && (
                <p className="rounded-xl border border-cat-blackhole/25 bg-cat-blackhole/[0.08] px-3 py-2 text-[11px] leading-relaxed text-cat-blackhole/90">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="font-mono text-[10px] text-subtle-foreground">
                  {text.length}/4000
                </span>
                <div className="flex items-center gap-2">
                  {text.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setText("");
                        setError(null);
                      }}
                    >
                      清空
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={parse}
                    disabled={text.trim().length < 2}
                    className="gap-1.5"
                  >
                    <Sparkles className="size-3.5" />
                    AI 解析
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- 解析阶段 ---------------- */}
          {stage === "parsing" && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-cat-deep" />
                AI 正在拆解你的速记…
              </p>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5"
                >
                  <span className="skeleton-line h-3 w-8 rounded-full" />
                  <span
                    className="skeleton-line h-3 flex-1 rounded-full"
                    style={{ maxWidth: `${76 - i * 9}%` }}
                  />
                </div>
              ))}
              <p className="text-[10px] text-subtle-foreground">
                推理模型需要几秒到十几秒，请稍候…
              </p>
            </div>
          )}

          {/* ---------------- 确认调整阶段 ---------------- */}
          {stage === "confirm" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-subtle-foreground">
                  解析出 <span className="font-mono text-cat-deep">{readyCount}</span> 项 · 可改标题、换象限或删除
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStage("input")}
                  disabled={importing}
                  className="gap-1 text-[11px]"
                >
                  <RotateCcw className="size-3" />
                  重新解析
                </Button>
              </div>

              <ul className="flex flex-col gap-2">
                {drafts.map((d) => {
                  const dot = CATEGORY_META[quadrantToCategory(d.quadrant)].dot;
                  return (
                    <li
                      key={d.key}
                      className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5 transition-colors focus-within:border-cat-deep/25"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn("size-2 shrink-0 rounded-full", dot)} />
                        <input
                          value={d.title}
                          onChange={(e) => updateDraft(d.key, { title: e.target.value })}
                          placeholder="任务标题"
                          disabled={importing}
                          className="min-w-0 flex-1 border-b border-transparent bg-transparent py-0.5 text-xs font-medium text-foreground outline-none transition-colors placeholder:text-subtle-foreground focus:border-cat-deep/30 disabled:opacity-60"
                        />
                        <button
                          onClick={() => removeDraft(d.key)}
                          disabled={importing}
                          aria-label="删除这条"
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-cat-blackhole/15 hover:text-cat-blackhole disabled:opacity-40"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <DarkSelect
                          value={d.quadrant}
                          options={QUADRANT_OPTIONS}
                          onChange={(q) => updateDraft(d.key, { quadrant: q })}
                          disabled={importing}
                          title={QUADRANT_META[d.quadrant].definition}
                          ariaLabel="选择象限"
                          className="flex-1"
                          menuMinWidth={168}
                        />

                        <DarkSelect
                          value={d.priority}
                          options={PRIORITY_OPTIONS}
                          onChange={(p) => updateDraft(d.key, { priority: p })}
                          disabled={importing}
                          title="优先级仅用于导入时的排序建议，暂不入库"
                          ariaLabel="选择优先级"
                          className="w-[92px] shrink-0"
                          menuMinWidth={92}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>

              <Button
                variant="ghost"
                size="sm"
                onClick={addDraft}
                disabled={importing}
                className="w-fit gap-1 text-[11px]"
              >
                <Plus className="size-3.5" />
                手动加一条
              </Button>

              <div className="mt-1 flex items-center gap-2 border-t border-white/[0.07] pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStage("input")}
                  disabled={importing}
                >
                  返回修改
                </Button>
                <Button
                  size="sm"
                  onClick={confirmImport}
                  disabled={importing || readyCount === 0}
                  className="ml-auto gap-1.5"
                >
                  {importing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  {importing
                    ? `导入中 ${progress.done}/${progress.total}`
                    : `确认导入${readyCount ? ` (${readyCount})` : ""}`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
