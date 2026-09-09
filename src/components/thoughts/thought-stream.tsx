"use client";

import { useEffect, useMemo, useState } from "react";
import { Lightbulb, WandSparkles, Loader2, Trash2, Plus } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { thoughtRepo } from "@/lib/thought-repository";
import { useAiStream } from "@/lib/use-ai-stream";
import type { Thought } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 灵感 / 思考流（Spark / Thought Stream）
 * - 随记闪念，不与执行任务混淆
 * - 每卡支持「拓展思路」→ 调 DeepSeek 流式拓展，结果持久化到 ai_expansion
 * - 按全局选中日期（selectedDate）归档回查
 */
export function ThoughtStream() {
  const { selectedDate } = useFlow();
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [input, setInput] = useState("");
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);

  // 加载中 = 尚未完成当前日期的加载（派生，避免在 effect 里同步 setState）
  const loading = loadedDate !== selectedDate;

  // 流式拓展：expandText 是正在逐字生成的最新拓展
  const { reply: expandText, streaming, error: expandError, send: streamExpand } =
    useAiStream("/api/ai/expand-thought");

  // 拉取当日灵感（selectedDate 变化时触发）
  useEffect(() => {
    let cancelled = false;
    thoughtRepo.fetchByDate(selectedDate).then((list) => {
      if (cancelled) return;
      setThoughts(list);
      setLoadedDate(selectedDate);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // 新增一条灵感
  const addThought = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const saved = await thoughtRepo.insert(text, selectedDate);
    if (saved) {
      setThoughts((prev) => [saved, ...prev]);
    }
  };

  // 拓展某条灵感
  const expandThought = async (id: string, content: string) => {
    if (streaming) return;
    setExpandingId(id);
    const full = await streamExpand({ content });
    if (full) {
      // 持久化到 ai_expansion
      await thoughtRepo.update(id, { aiExpansion: full });
      setThoughts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, aiExpansion: full } : t))
      );
    }
    setExpandingId(null);
  };

  // 删除灵感
  const removeThought = async (id: string) => {
    const ok = await thoughtRepo.remove(id);
    if (ok) setThoughts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <section className="flex flex-col gap-4">
      {/* 区块标题 */}
      <div className="flex items-end justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Lightbulb className="size-4 text-candle" />
          灵感与思考
          <span className="font-normal text-subtle-foreground">Thought Stream · 随记闪念</span>
        </h3>
        <p className="text-[11px] text-subtle-foreground">{thoughts.length} 条</p>
      </div>

      {/* 输入区 */}
      <div className="glass animate-fade-up flex flex-col gap-2 rounded-2xl p-3.5">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="记下一个闪念、灵感或此刻的思绪…（与任务无关也没关系）"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addThought();
          }}
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-subtle-foreground">Ctrl / ⌘ + Enter 快速记录</p>
          <Button size="sm" onClick={addThought} disabled={!input.trim()} className="gap-1">
            <Plus className="size-3.5" />
            记下
          </Button>
        </div>
      </div>

      {/* 卡片时间轴流 */}
      <div className="flex flex-col gap-3">
        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-subtle-foreground" />
          </div>
        )}

        {!loading && thoughts.length === 0 && (
          <div className="glass flex flex-col items-center gap-2 rounded-2xl py-8 text-center">
            <Lightbulb className="size-5 text-candle/50" />
            <p className="text-xs text-subtle-foreground">
              这一天还没有灵感记录。捕捉一个转瞬即逝的念头吧。
            </p>
          </div>
        )}

        {thoughts.map((t) => (
          <ThoughtCard
            key={t.id}
            thought={t}
            expanding={expandingId === t.id}
            streamingText={expandingId === t.id ? expandText : ""}
            onExpand={() => expandThought(t.id, t.content)}
            onRemove={() => removeThought(t.id)}
          />
        ))}

        {expandError && (
          <p className="text-center text-[11px] text-cat-blackhole/80">{expandError}</p>
        )}
      </div>
    </section>
  );
}

function ThoughtCard({
  thought,
  expanding,
  streamingText,
  onExpand,
  onRemove,
}: {
  thought: Thought;
  expanding: boolean;
  streamingText: string;
  onExpand: () => void;
  onRemove: () => void;
}) {
  const time = useMemo(() => {
    try {
      const d = new Date(thought.createdAt);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [thought.createdAt]);

  return (
    <div className="glass animate-fade-up flex flex-col gap-2.5 rounded-2xl p-4">
      {/* 原文 + 时间 + 操作 */}
      <div className="flex items-start gap-3">
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-candle" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-foreground/90">{thought.content}</p>
          {time && (
            <p className="mt-1.5 font-mono text-[10px] text-subtle-foreground">{time}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={onExpand}
            disabled={expanding}
            className="gap-1 text-[11px] text-candle hover:bg-candle/10"
          >
            {expanding ? <Loader2 className="size-3 animate-spin" /> : <WandSparkles className="size-3" />}
            拓展思路
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={onRemove}
            className="text-[11px] text-subtle-foreground hover:bg-cat-blackhole/10 hover:text-cat-blackhole"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* AI 拓展区 */}
      {(expanding || thought.aiExpansion) && (
        <div
          className={cn(
            "rounded-xl border border-candle/15 bg-candle/[0.04] p-3",
            expanding && "glow-candle"
          )}
        >
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-candle/60">
            <WandSparkles className="size-3" />
            AI 拓展
          </p>
          <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
            {expanding ? (
              <>
                {streamingText}
                <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-candle/70 align-middle" />
              </>
            ) : (
              thought.aiExpansion
            )}
          </p>
        </div>
      )}
    </div>
  );
}
