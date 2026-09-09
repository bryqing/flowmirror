"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAiStream } from "@/lib/use-ai-stream";
import { cn } from "@/lib/utils";

/**
 * 全局战局 AI 调度分析（Global AI Tactician）
 * 入口按钮 + 抽屉面板：流式呈现三维度分析（战局诊断 / 行动序列 / 熔断建议）。
 * - 复用 Sheet（React Portal 挂载 document.body，ESC/遮罩关闭）
 * - 复用 useAiStream（SSE 打字机）
 */
export function GlobalDispatchPanel() {
  const { tasks } = useFlow();
  const [open, setOpen] = useState(false);
  const { reply, streaming, error, send } = useAiStream(
    "/api/ai/global-dispatch"
  );
  // 自动滚动到底部
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reply, open, streaming]);

  // 组装完整任务画像（含已完成/冷冻，供整体负载研判）
  const payload = useMemo(
    () => ({
      tasks: tasks.map((t) => ({
        title: t.title,
        category: t.category,
        status: t.status,
        plannedDuration: t.plannedDuration,
        actualDuration: t.actualDuration,
      })),
      now: new Date().toLocaleString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    }),
    [tasks]
  );

  const analyze = async () => {
    await send(payload);
  };

  const emptyMessage = tasks.length === 0 ? "当前战局空空如也，暂无任务可调度。" : null;

  return (
    <>
      {/* 入口按钮 */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5 border-cat-deep/25 text-cat-deep hover:bg-cat-deep/10"
      >
        <Sparkles className="size-3.5" />
        战局调度
      </Button>

      {/* 抽屉面板 */}
      <Sheet open={open} onClose={() => setOpen(false)} title="全局战局调度">
        <div className="flex h-full flex-col px-5 pb-5">
          {/* 顶部状态与重试 */}
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] text-subtle-foreground">
              三维度研判：战局诊断 · 行动序列 · 熔断建议
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={analyze}
              disabled={streaming || tasks.length === 0}
              className="gap-1 text-[11px]"
            >
              <RefreshCw className={cn("size-3", streaming && "animate-spin")} />
              {streaming ? "分析中" : reply ? "重新分析" : "开始分析"}
            </Button>
          </div>

          {/* 内容区 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {emptyMessage && !streaming && (
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            )}

            {!emptyMessage && !streaming && !reply && !error && (
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm text-muted-foreground">
                点击右上角「开始分析」，让战术指挥官为你研判当前四象限战局，给出冲刺顺序与熔断建议。
              </div>
            )}

            {streaming && !reply && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-cat-deep" />
                正在研判战局…
              </div>
            )}

            {reply && (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {reply}
                {streaming && (
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-cat-deep align-middle" />
                )}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-cat-blackhole/30 bg-cat-blackhole/10 p-4 text-sm text-cat-blackhole/90">
                {error}
              </div>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
}
