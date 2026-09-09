"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Send, Loader2, X } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useAiStream } from "@/lib/use-ai-stream";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * 深夜深潜：开放式认知对话（烛光模式下可用的深度交流入口）
 * - 多轮对话，调用 /api/ai/deep-dive（deepseek-v4-pro 强化推理）
 * - 温和克制、低刺激的视觉风格，贴合深夜场景
 */
export function DeepDivePanel() {
  const { candleMode } = useFlow();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 流式对话：reply 是正在逐字生成的最新助手回复
  const { reply, streaming, error, send: streamSend } = useAiStream(
    "/api/ai/deep-dive",
    () => bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, reply]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);

    const full = await streamSend({ messages: next });
    if (full) {
      // 流式结束后，把最终完整回复写入消息列表
      setMessages((prev) => [...prev, { role: "assistant", content: full }]);
    }
  };

  return (
    <>
      {/* 入口：仅在烛光模式显示，静默低调 */}
      {candleMode && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="深夜深潜"
          className={cn(
            "pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]",
            "border backdrop-blur-md transition-all",
            open
              ? "opacity-0"
              : "border-candle/25 bg-candle/10 text-candle hover:bg-candle/15"
          )}
        >
          <Moon className="size-3.5" />
          深夜深潜
        </button>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="深夜深潜 · 认知对话">
        <div className="flex h-[60vh] flex-col px-5 pb-6 pt-1">
          {/* 消息区 */}
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <div className="mt-8 flex flex-col items-center gap-3 text-center">
                <Moon className="size-6 text-candle/60" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  夜深了。想聊点什么？
                  <br />
                  <span className="text-xs text-subtle-foreground">
                    时间的去向、注意力的结构，或某个一直盘旋的困惑。
                  </span>
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                    m.role === "user"
                      ? "bg-cat-deep/15 text-cat-deep"
                      : "bg-white/[0.05] text-muted-foreground"
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-white/[0.05] px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  {reply ? (
                    <>
                      {reply}
                      <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-candle/70 align-middle" />
                    </>
                  ) : (
                    <span className="flex items-center gap-2 text-subtle-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      正在思考…
                    </span>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p className="text-center text-[11px] text-cat-blackhole/80">{error}</p>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 输入区 */}
          <div className="mt-3 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder="说点什么…"
              className="h-9 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus:border-candle/40"
            />
            <Button
              size="sm"
              onClick={send}
              disabled={streaming || !input.trim()}
              className="gap-1 bg-candle/90 text-background hover:bg-candle"
            >
              {streaming ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          </div>

          <p className="mt-2 flex items-center justify-center gap-1 text-center text-[10px] text-subtle-foreground">
            <X className="size-3" />
            低刺激对话 · 温和克制 · 不评判
          </p>
        </div>
      </Sheet>
    </>
  );
}
