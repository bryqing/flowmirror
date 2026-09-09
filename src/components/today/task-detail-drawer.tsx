"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
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
import { CATEGORY_META } from "@/lib/types";
import { cn, fmtClock, fmtDuration } from "@/lib/utils";
import { ensureNotifyPermission, playBrake, playChime, notify } from "@/lib/sound";
import { useAi } from "@/lib/use-ai";
import { WandSparkles, Loader2 } from "lucide-react";

type TimerState = "idle" | "running" | "paused" | "finished";

export function TaskDetailDrawer() {
  const { detailTask, closeDetail, completeTask } = useFlow();
  const open = !!detailTask;

  const [timer, setTimer] = useState<TimerState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const finishedRef = useRef(false);

  const { loading: aiLoading, result: aiResult, error: aiError, run: runTactic } = useAi<{ tactic: string }>("/api/ai/tactic");

  const isBlackhole = detailTask?.category === "blackhole";
  const done = detailTask?.status === "done";
  const frozen = detailTask?.status === "frozen";

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
          <div className="min-w-0">
            <h3 className={cn("text-base font-medium leading-snug tracking-tight", done && "text-muted-foreground line-through")}>
              {detailTask.title}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                variant={
                  detailTask.category === "deep-work" ? "deep"
                  : detailTask.category === "chore" ? "chore"
                  : detailTask.category === "blackhole" ? "blackhole"
                  : "rest"
                }
              >
                {meta.label}
              </Badge>
              {detailTask.scheduledTime && (
                <span className="font-mono text-[11px] text-subtle-foreground">{detailTask.scheduledTime}</span>
              )}
              {detailTask.plannedDuration && (
                <span className="text-[11px] text-subtle-foreground">计划 {fmtDuration(detailTask.plannedDuration)}</span>
              )}
              {frozen && <Badge variant="chore">已熔断冷冻</Badge>}
              {done && <Badge variant="rest">已完成</Badge>}
            </div>
          </div>
        </div>

        {/* 计时器 */}
        {!frozen && (
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
              <p className="text-xs leading-relaxed text-muted-foreground">{aiResult.tactic}</p>
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
                <li key={i} className="flex gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
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
        {!done && !frozen && (
          <Button className="w-full gap-1.5" onClick={handleComplete}>
            <CheckCircle2 className="size-4" />
            打钩完成 · 唤起微复盘
          </Button>
        )}
        {done && (
          <p className="text-center text-[11px] text-subtle-foreground">
            已完成{detailTask.microReviews.length > 0 ? "并完成微复盘入库" : "，可在上方按钮补录复盘"}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function TimerRing({ progress, color }: { progress: number; color: "deep" | "blackhole" }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const stroke = color === "deep" ? "var(--color-cat-deep)" : "var(--color-cat-blackhole)";
  return (
    <span className="relative inline-flex size-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
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
