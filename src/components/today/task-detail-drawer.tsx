"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FastForward,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFlow } from "@/components/flow-context";
import {
  CATEGORY_META,
  QUADRANT_META,
  QUADRANT_ORDER,
  categoryToQuadrant,
  type Quadrant,
  type Task,
} from "@/lib/types";
import { cn, fmtClock, fmtDuration } from "@/lib/utils";
import { ensureNotifyPermission, playBrake, playChime, notify } from "@/lib/sound";
import { useAi } from "@/lib/use-ai";
import { WandSparkles, Loader2 } from "lucide-react";

type TimerState = "idle" | "running" | "paused" | "finished";

export function TaskDetailDrawer() {
  const { detailTask, closeDetail, completeTask, reopenTask, moveTaskQuadrant } = useFlow();
  const open = !!detailTask;

  const [timer, setTimer] = useState<TimerState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const finishedRef = useRef(false);
  /** 象限选择器是否展开（顶部胶囊 → 四选一） */
  const [quadrantOpen, setQuadrantOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const { loading: aiLoading, result: aiResult, error: aiError, run: runTactic } = useAi("/api/ai/tactic");

  const isBlackhole = detailTask?.category === "blackhole";
  const done = detailTask?.status === "done";
  const frozen = detailTask?.status === "frozen";

  /* 切换任务 / 关闭时收起象限选择器，避免下次打开残留展开态 */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuadrantOpen(false);
  }, [detailTask?.id]);

  /* 点击外部收起象限选择器（Portal 内的下拉同理会命中"面板外"，
     但这里的选择器是面板内联渲染的普通 div，不存在嵌套 Portal 的误杀问题） */
  useEffect(() => {
    if (!quadrantOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setQuadrantOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [quadrantOpen]);

  const startTimer = useCallback((minutes: number) => {
    const total = minutes * 60;
    setTotalSeconds(total);
    setSecondsLeft(total);
    setTimer("running");
    finishedRef.current = false;
    void ensureNotifyPermission();
  }, []);

  /* 打开任务时重置；黑洞进行中的任务自动开始倒计时 */
  useEffect(() => {
    if (!detailTask) return;
    finishedRef.current = false;
    if (detailTask.category === "blackhole" && detailTask.status === "in-progress") {
      startTimer(detailTask.blackholeMinutes ?? 30);
    } else {
      setTimer("idle");
      setTotalSeconds(25 * 60);
      setSecondsLeft(25 * 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTask?.id]);

  useEffect(() => {
    if (timer !== "running") return;
    const iv = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(iv);
  }, [timer]);

  /* 倒计时结束：提示音 + 通知 + 关闭详情、唤起微复盘 */
  useEffect(() => {
    if (timer === "running" && secondsLeft <= 0 && detailTask && !finishedRef.current) {
      finishedRef.current = true;
      setTimer("finished");
      if (detailTask.category === "blackhole") {
        playBrake();
        notify("刹车！黑洞时间到", `${detailTask.title} 已满，回到正事。`);
      } else {
        playChime();
        notify("番茄钟结束", `${detailTask.title} —— 做得好，来做个 10 秒微复盘。`);
      }
      const id = detailTask.id;
      closeDetail();
      setTimeout(() => completeTask(id), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, timer]);

  if (!detailTask) {
    return <Sheet open={false} onClose={closeDetail} title="任务详情"><div /></Sheet>;
  }

  const meta = CATEGORY_META[detailTask.category];
  const progress = totalSeconds > 0 ? 1 - secondsLeft / totalSeconds : 0;
  const timerActive = timer === "running" || timer === "paused" || timer === "finished";

  const handleComplete = () => {
    const id = detailTask.id;
    closeDetail();
    setTimeout(() => completeTask(id), 300);
  };

  return (
    <Sheet open={open} onClose={closeDetail} title="任务详情 · 战前锦囊">
      <div className="flex flex-col gap-5 px-5 pb-8 pt-1">
        {/* 标题区 */}
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border", meta.bg, meta.border)}>
            <Timer className={cn("size-4.5", meta.text)} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className={cn("text-base font-medium leading-snug tracking-tight", done && "text-muted-foreground line-through")}>
              {detailTask.title}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {/* 象限归属：静态标签 → 可点击的胶囊选择器（四象限任意互转） */}
              <QuadrantPicker
                current={detailTask.category}
                open={quadrantOpen}
                onToggle={() => setQuadrantOpen((v) => !v)}
                onPick={(q) => {
                  setQuadrantOpen(false);
                  moveTaskQuadrant(detailTask.id, q);
                }}
                pickerRef={pickerRef}
                disabled={frozen}
              />
              {detailTask.scheduledTime && (
                <span className="font-mono text-[11px] text-subtle-foreground">{detailTask.scheduledTime}</span>
              )}
              {detailTask.plannedDuration && (
                <span className="text-[11px] text-subtle-foreground">计划 {fmtDuration(detailTask.plannedDuration)}</span>
              )}
              {frozen && <Badge variant="chore">已熔断冷冻</Badge>}
              {/* 「已完成」胶囊本身可点：点一下即撤回（与卡片上再点圆圈等价） */}
              {done && (
                <button
                  data-drawer-reopen
                  onClick={() => reopenTask(detailTask.id)}
                  title="点击撤回完成"
                  className="group/reopen inline-flex items-center gap-1 rounded-full border border-cat-rest/40 bg-cat-rest/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-cat-rest transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-600"
                >
                  <CheckCircle2 className="size-3 group-hover/reopen:hidden" />
                  <RotateCcw className="hidden size-3 group-hover/reopen:block" />
                  已完成
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 计时器：已完成任务不再显示（要计时就先撤回，避免"已完成的还在跑倒计时"） */}
        {!frozen && !done && (
          <div
            className={cn(
              "flex items-center gap-4 rounded-2xl border p-4",
              isBlackhole ? "border-cat-blackhole/25 bg-cat-blackhole/[0.06] glow-blackhole" : "border-cat-deep/20 bg-cat-deep/[0.05] glow-deep"
            )}
          >
            <TimerRing progress={progress} color={isBlackhole ? "blackhole" : "deep"} />
            <div className="leading-none">
              <p className="font-mono text-3xl font-light tabular-nums tracking-tight">
                {fmtClock(Math.max(secondsLeft, 0))}
              </p>
              <p className="mt-1.5 text-[11px] text-subtle-foreground">
                {isBlackhole ? "黑洞倒计时 · 到点刹车强提醒" : "沉浸番茄钟 · 25 分钟"}
              </p>
            </div>
            <div className="ml-auto flex flex-col gap-1.5">
              {timerActive ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setTimer((t) => (t === "running" ? "paused" : "running"))}
                  >
                    {timer === "running" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                    {timer === "running" ? "暂停" : "继续"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-subtle-foreground"
                    onClick={() => setSecondsLeft(5)}
                    title="演示：跳到最后 5 秒"
                  >
                    <FastForward className="size-3.5" />
                    演示加速
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => startTimer(isBlackhole ? detailTask.blackholeMinutes ?? 30 : 25)}>
                  <Play className="size-3.5" />
                  {isBlackhole ? `开始 ${detailTask.blackholeMinutes ?? 30} 分钟倒计时` : "开始专注 25:00"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* AI 战术锦囊 */}
        {!frozen && !done && (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-cat-deep/20 bg-cat-deep/[0.04] p-3.5 glow-deep">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-medium text-cat-deep">
                <WandSparkles className="size-3.5" />
                AI 战术锦囊
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-[11px] text-cat-deep hover:bg-cat-deep/10"
                onClick={() =>
                  runTactic({
                    tasks: [
                      {
                        title: detailTask.title,
                        category: detailTask.category,
                        status: detailTask.status,
                        plannedDuration: detailTask.plannedDuration,
                      },
                    ],
                  })
                }
                disabled={aiLoading}
              >
                {aiLoading ? <Loader2 className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
                {aiLoading ? "生成中…" : "给我锦囊"}
              </Button>
            </div>
            {aiResult && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{aiResult}</p>
            )}
            {aiError && (
              <p className="text-[11px] leading-relaxed text-cat-blackhole/80">{aiError}</p>
            )}
            {!aiResult && !aiError && (
              <p className="text-[11px] leading-relaxed text-subtle-foreground">
                基于当前任务，让 AI 给你一个开局动作 + 避坑提醒。
              </p>
            )}
          </div>
        )}

        {/* 战前锦囊 SOP */}
        {detailTask.sops.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <ListChecks className="size-3.5 text-cat-deep" />
              极简执行 SOP
            </p>
            <ol className="flex flex-col gap-1.5">
              {detailTask.sops.map((sop, i) => (
                <li key={i} className="flex gap-2.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-mono text-[10px] text-cat-deep/70">{String(i + 1).padStart(2, "0")}</span>
                  {sop}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* 历史避坑教训 */}
        {detailTask.pitfalls.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-2xl border border-candle/20 bg-candle/[0.06] p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-candle">
              <AlertTriangle className="size-3.5" />
              历史避坑教训（同类任务沉淀）
            </p>
            {detailTask.pitfalls.map((p, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-candle/85">· {p}</p>
            ))}
          </div>
        )}

        {/* 时间切片 */}
        {detailTask.timeSlices.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">今日时间切片</p>
            {detailTask.timeSlices.map((s, i) => (
              <p key={i} className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono text-[10px] text-subtle-foreground">
                  {s.start}{s.end ? `–${s.end}` : " 起"}
                </span>
                <span className={cn(s.runaway && "text-cat-blackhole")}>{s.label}</span>
              </p>
            ))}
          </div>
        )}

        {/* 已有微复盘 */}
        {detailTask.microReviews.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-cat-rest">
              <Sparkles className="size-3.5" />
              已沉淀微复盘
            </p>
            {detailTask.microReviews.map((r) => (
              <div key={r.id} className="rounded-xl border border-cat-rest/15 bg-cat-rest/[0.05] p-3">
                <div className="flex flex-wrap gap-1">
                  {r.blockerTags.map((t) => (
                    <span key={t} className="rounded bg-cat-blackhole/15 px-1.5 py-px text-[10px] text-cat-blackhole">{t}</span>
                  ))}
                  {r.lessonTags.map((t) => (
                    <span key={t} className="rounded bg-cat-rest/15 px-1.5 py-px text-[10px] text-cat-rest">{t}</span>
                  ))}
                </div>
                {r.note && <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{r.note}</p>}
                <p className="mt-1 font-mono text-[10px] text-subtle-foreground">{r.createdAt}</p>
              </div>
            ))}
          </div>
        )}

        {/* 底部操作 */}
        {!frozen && !done && (
          <Button className="w-full gap-1.5" onClick={handleComplete}>
            <CheckCircle2 className="size-4" />
            打钩完成 · 唤起微复盘
          </Button>
        )}
        {/* 已完成 → 明确给出「撤回」出口（与顶部胶囊、卡片圆圈三处等价） */}
        {done && !frozen && (
          <Button
            data-drawer-reopen-btn
            variant="secondary"
            className="w-full gap-1.5"
            onClick={() => reopenTask(detailTask.id)}
          >
            <RotateCcw className="size-4" />
            标记为未完成 · 撤回完成
          </Button>
        )}
        {done && (
          <p className="text-center text-[11px] leading-relaxed text-subtle-foreground">
            撤回后任务回到「{meta.label}」
            {detailTask.category === "rest" ? "（全局待执行池）" : "（今日战局）"}，
            可继续计时与打卡；已记录 {detailTask.timeSlices.length > 0 ? "的计时切片与" : ""}微复盘会保留。
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * 象限归属选择器 —— 把原来静态的象限标签变成可点开的四选一。
 *
 * 内联在抽屉面板里（不另起 Portal）：这样"点击外部收起"只需判断
 * 本容器的 contains，不会撞上"嵌套 Portal 被当成面板外点击"那个坑。
 * 选择器本身用绝对定位展开成一个浮层，不改动标题区的高度。
 */
function QuadrantPicker({
  current,
  open,
  onToggle,
  onPick,
  pickerRef,
  disabled,
}: {
  current: Task["category"];
  open: boolean;
  onToggle: () => void;
  onPick: (q: Quadrant) => void;
  pickerRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
}) {
  const meta = CATEGORY_META[current];
  const currentQuadrant = categoryToQuadrant(current);

  return (
    <div ref={pickerRef} className="relative inline-flex">
      <button
        data-quadrant-picker
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`当前归属「${meta.label}」，点击切换象限`}
        title={disabled ? "已冷冻，解冻后可调整象限" : "点击切换象限"}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition-all",
          meta.border,
          meta.bg,
          meta.text,
          !disabled && "hover:brightness-[0.97]",
          disabled && "cursor-not-allowed opacity-60"
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
        {meta.label}
        <ChevronDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          data-quadrant-options
          aria-label="选择象限"
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {QUADRANT_ORDER.map((q) => {
            const qm = QUADRANT_META[q];
            const cm = CATEGORY_META[qm.category];
            const isCurrent = q === currentQuadrant;
            return (
              <button
                key={q}
                role="option"
                aria-selected={isCurrent}
                data-quadrant-option={q}
                onClick={() => onPick(q)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                  isCurrent ? "bg-slate-100" : "hover:bg-slate-50"
                )}
              >
                <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", cm.dot)} />
                <span className="min-w-0 flex-1">
                  <span className={cn("flex items-baseline gap-1.5 text-xs font-medium", cm.text)}>
                    <span className="font-mono text-[9px] opacity-60">{q.toUpperCase()}</span>
                    {qm.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-subtle-foreground">
                    {qm.hint}
                  </span>
                </span>
                {isCurrent && <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-slate-400" />}
              </button>
            );
          })}
          <p className="px-2 pb-1 pt-1.5 text-[10px] leading-snug text-subtle-foreground">
            四个象限可任意互转，切换后立即归入对应板块。
          </p>
        </div>
      )}
    </div>
  );
}

function TimerRing({ progress, color }: { progress: number; color: "deep" | "blackhole" }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const stroke = color === "deep" ? "var(--color-cat-deep)" : "var(--color-cat-blackhole)";
  return (
    <span className="relative inline-flex size-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(15,23,42,0.1)" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke={stroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <Timer className={cn("absolute size-5", color === "deep" ? "text-cat-deep/80" : "text-cat-blackhole/80")} />
    </span>
  );
}
