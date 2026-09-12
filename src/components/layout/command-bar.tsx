"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Mic, Orbit, Sparkles } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { COMMAND_SUGGESTIONS, parseCommand } from "@/lib/nlp";
import { useSpeech } from "@/lib/use-speech";
import { cn } from "@/lib/utils";

export function CommandBar() {
  const { executeCommand } = useFlow();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 平台探测：初值固定 false，SSR 与客户端首帧一致；挂载后再异步探测
  const [isMac, setIsMac] = useState(false);

  // 语音输入：实时转录到输入框
  // 注：supported 由 useSpeech 内部用「初值 false + useEffect 异步探测」做水合安全：
  // SSR 与客户端首帧都不渲染语音按钮，挂载后再补渲染，不产生 Hydration 报错
  const { supported: speechSupported, listening, error: speechError, start: startSpeech, stop: stopSpeech } =
    useSpeech((text) => setValue(text));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.platform + navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const parsed = useMemo(() => (value.trim() ? parseCommand(value) : null), [value]);

  const submit = () => {
    if (!value.trim()) return;
    const cmd = parseCommand(value);
    executeCommand(cmd);
    setValue("");
    inputRef.current?.blur();
  };

  return (
    /* 今日战局顶部：独立通栏一行，静态文档流，绝不悬浮插入下方 2x2 网格 */
    <div className="animate-fade-up">
      <div
        className={cn(
          "glass-strong rounded-2xl px-4 py-3.5 sm:px-5",
          "shadow-[0_0_28px_-10px_rgba(103,232,249,0.25),0_4px_24px_rgba(0,0,0,0.4)]",
          focused &&
            "border-cat-deep/40 shadow-[0_0_0_3px_rgba(103,232,249,0.09),0_0_36px_-8px_rgba(103,232,249,0.35),0_4px_24px_rgba(0,0,0,0.4)]"
        )}
      >
        {/* 单行命令条：品牌标识 + 自然语言输入 + 快捷键 + 提交 */}
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
            <Orbit className="size-4 text-cat-deep" />
          </span>
          <div className="hidden shrink-0 leading-tight md:block">
            <p className="text-xs font-semibold tracking-tight">FlowMirror</p>
            <p className="text-[10px] text-subtle-foreground">自然语言调度</p>
          </div>
          <span className="hidden h-5 w-px shrink-0 bg-white/10 md:block" />

          <Sparkles
            className={cn(
              "size-4 shrink-0 transition-colors",
              focused ? "text-cat-deep" : "text-subtle-foreground"
            )}
          />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder='用一句话安排时间："明天上午10点整理报表"、"刷半小时视频"'
            className="h-8 min-w-0 flex-1 bg-transparent pl-2 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
          />

          <span className="hidden shrink-0 items-center gap-1 text-[10px] text-subtle-foreground sm:flex">
            <span className="kbd">{isMac ? "⌘" : "Ctrl"}</span>
            <span className="kbd">K</span>
          </span>

          {/* 语音输入：仅在浏览器支持时显示 */}
          {speechSupported && (
            <button
              onClick={listening ? stopSpeech : startSpeech}
              aria-label={listening ? "停止录音" : "语音输入"}
              className={cn(
                "relative flex size-7 shrink-0 items-center justify-center rounded-lg transition-all",
                listening
                  ? "bg-cat-blackhole/20 text-cat-blackhole"
                  : "bg-white/[0.07] text-muted-foreground hover:bg-cat-deep/20 hover:text-cat-deep"
              )}
            >
              {listening && (
                <span className="absolute inset-0 rounded-lg bg-cat-blackhole/40 animate-ping" />
              )}
              <Mic className={cn("relative size-3.5", listening && "animate-pulse")} />
            </button>
          )}

          <button
            onClick={submit}
            aria-label="执行指令"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-muted-foreground transition-all hover:bg-cat-deep/20 hover:text-cat-deep"
          >
            <ArrowRight className="size-3.5" />
          </button>
        </div>

        {/* 实时解析预览 */}
        <div
          className={cn(
            "grid transition-all duration-300",
            parsed && focused ? "mt-2.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden">
            <div className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3.5 py-2.5 text-xs leading-relaxed">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-cat-deep animate-breathe" />
              <p className="text-muted-foreground" data-command-preview>
                <span className="mr-1.5 rounded bg-cat-deep/15 px-1.5 py-0.5 text-[10px] font-medium text-cat-deep">
                  {intentLabel(parsed?.intent)}
                </span>
                {parsed?.summary}
              </p>
            </div>
          </div>
        </div>

        {/* 语音错误提示 */}
        {speechError && (
          <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-cat-blackhole/80">
            <Mic className="size-3" />
            {speechError}
          </p>
        )}

        {/* 快捷示例（移动端常驻，桌面端聚焦时显示） */}
        <div
          className={cn(
            "mt-2.5 flex flex-wrap gap-1.5 transition-opacity duration-300 sm:opacity-0",
            focused && "sm:opacity-100"
          )}
        >
          {COMMAND_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setValue(s);
                inputRef.current?.focus();
              }}
              className="rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-white/15 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function intentLabel(intent?: string) {
  switch (intent) {
    case "add": return "新增任务";
    case "reschedule": return "改期顺延";
    case "blackhole": return "休闲娱乐计时";
    case "fuse": return "熔断关怀";
    default: return "试试";
  }
}

/** 全局轻提示 */
export function Toaster() {
  const { toasts } = useFlow();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "glass-strong animate-fade-up pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-3 text-xs leading-relaxed",
            t.tone === "danger" && "glow-blackhole border-cat-blackhole/30",
            t.tone === "warn" && "border-candle/30",
            t.tone === "success" && "border-cat-rest/25"
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              t.tone === "danger" && "bg-cat-blackhole",
              t.tone === "warn" && "bg-candle",
              t.tone === "success" && "bg-cat-rest",
              t.tone === "info" && "bg-cat-deep"
            )}
          />
          <p className="text-foreground/90">{t.message}</p>
        </div>
      ))}
    </div>
  );
}
