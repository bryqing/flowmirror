"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Clock, Flame, Lightbulb, Loader2, Sparkles, Timer } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAiStream } from "@/lib/use-ai-stream";
import type { DayMirror } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 把 "HH:MM" 起止转为分钟数差 */
function sliceMinutes(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

/**
 * 昨日时间黑洞 · 溯源详情抽屉
 * - 点击四象限上方的黑洞卡片 / 具体条目唤起
 * - 展示每个失控段的时间、时长、来源，并关联昨日沉淀的踩坑教训
 * - 顶部一键生成「今日注意力保护方案」（AI 流式）
 */
export function BlackholeDetailDrawer({
  open,
  mirror,
  focusIndex,
  onClose,
}: {
  open: boolean;
  mirror: DayMirror;
  /** 被点击的具体条目索引（高亮定位），null 表示从整卡进入 */
  focusIndex: number | null;
  onClose: () => void;
}) {
  const { reply, streaming, error, send } = useAiStream("/api/ai/blackhole-tactic");
  const focusedRef = useRef<HTMLDivElement>(null);

  // 聚焦到被点击的条目
  useEffect(() => {
    if (open && focusIndex != null && focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [open, focusIndex]);

  const slices = mirror.blackholeSlices;

  /**
   * 关联该切片的踩坑教训：用双向关键词包含匹配。
   * 例：「刷短视频 · 午休」↔「午休黑洞」→ 命中「午休」；
   *     「游戏摸鱼」↔ 教训正文含「游戏」→ 命中。
   */
  const relatedLessons = (label?: string) => {
    if (!label) return [];
    // 拆分出有意义的关键词（去掉时间修饰、分隔符，保留 2 字以上的词块）
    const tokens = label
      .split(/[·\s、,，/]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) return [];
    return mirror.lessons.filter((l) => {
      const haystack = `${l.taskTitle}${l.text}`;
      return tokens.some(
        (tk) =>
          l.taskTitle.includes(tk) ||
          tk.includes(l.taskTitle) ||
          haystack.includes(tk)
      );
    });
  };

  const analyze = async () => {
    await send({
      slices: slices.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
        runaway: s.runaway,
      })),
      totalMinutes: mirror.blackholeMinutes,
      comment: mirror.blackholeComment,
      lessons: mirror.lessons.map((l) => ({ taskTitle: l.taskTitle, text: l.text })),
      now: new Date().toLocaleString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title="昨日时间黑洞 · 失控溯源">
      <div className="flex flex-col gap-5 px-5 pb-8 pt-1">
        {/* 概览 */}
        <div className="flex items-center gap-3 rounded-2xl border border-cat-blackhole/20 bg-cat-blackhole/[0.07] p-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cat-blackhole/15">
            <Flame className="size-4.5 text-cat-blackhole" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-lg font-light tabular-nums text-cat-blackhole">
              {Math.floor(mirror.blackholeMinutes / 60)} 小时{" "}
              {mirror.blackholeMinutes % 60 > 0 ? `${mirror.blackholeMinutes % 60} 分` : ""}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {mirror.dateLabel} · 共 {slices.length} 段，失控{" "}
              {slices.filter((s) => s.runaway).length} 段
            </p>
          </div>
        </div>

        {/* AI 保护方案 */}
        <div className="flex flex-col gap-2.5 rounded-2xl border border-cat-deep/20 bg-cat-deep/[0.04] p-3.5 glow-deep">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-cat-deep">
              <Sparkles className="size-3.5" />
              今日注意力保护方案
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-[11px] text-cat-deep hover:bg-cat-deep/10"
              onClick={analyze}
              disabled={streaming}
            >
              {streaming ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {streaming ? "分析中…" : reply ? "重新分析" : "生成方案"}
            </Button>
          </div>
          {reply ? (
            <p className="whitespace-pre-line text-xs leading-relaxed text-zinc-300">{reply}</p>
          ) : error ? (
            <p className="text-[11px] leading-relaxed text-cat-blackhole/80">{error}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-subtle-foreground">
              基于昨日失控时段与诱因，让 AI 给你今日可立即执行的环境防线与动作清单。
            </p>
          )}
        </div>

        {/* 失控时段明细 */}
        <div className="flex flex-col gap-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
            <Timer className="size-3.5 text-cat-blackhole" />
            时段明细 · 逐段溯源
          </p>
          {slices.map((s, i) => {
            const mins = sliceMinutes(s.start, s.end);
            const lessons = relatedLessons(s.label);
            const focused = focusIndex === i;
            return (
              <div
                key={i}
                ref={focused ? focusedRef : undefined}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-3.5 transition-colors",
                  s.runaway
                    ? "border-cat-blackhole/25 bg-cat-blackhole/[0.06]"
                    : "border-white/[0.07] bg-white/[0.02]",
                  focused && "ring-2 ring-cat-blackhole/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-cat-blackhole/85">
                    {s.start}–{s.end}
                  </span>
                  {mins != null && (
                    <span className="flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-px text-[10px] text-zinc-400">
                      <Clock className="size-2.5" />
                      {mins} 分钟
                    </span>
                  )}
                  {s.runaway && (
                    <span className="rounded bg-cat-blackhole/15 px-1.5 py-px text-[10px] text-cat-blackhole">
                      失控段
                    </span>
                  )}
                </div>
                <p className={cn("text-xs", s.runaway ? "text-cat-blackhole" : "text-zinc-200")}>
                  {s.label}
                </p>
                {lessons.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-2">
                    <p className="flex items-center gap-1 text-[10px] text-candle">
                      <Lightbulb className="size-2.5" />
                      已沉淀的避坑教训
                    </p>
                    {lessons.map((l, li) => (
                      <p key={li} className="text-[10px] leading-relaxed text-zinc-400">
                        · {l.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* AI 警示简评 */}
        <div className="flex items-start gap-2 rounded-xl border border-cat-blackhole/20 bg-cat-blackhole/[0.05] p-3.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-cat-blackhole/90" />
          <p className="text-[11px] leading-relaxed text-zinc-300">{mirror.blackholeComment}</p>
        </div>
      </div>
    </Sheet>
  );
}
