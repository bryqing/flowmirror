"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 流式对话 hook：消费 SSE（text/event-stream）端点，逐段累加文本
 * 用于深夜深潜等打字机效果的多轮对话场景。
 *
 * 用法：
 *   const { reply, streaming, error, send } = useAiStream("/api/ai/deep-dive");
 *   await send({ messages: [...] });
 *
 * @param endpoint POST 的流式端点（返回 text/event-stream）
 * @param onDelta 可选回调，每收到一段增量时触发（如用于自动滚动）
 */
export function useAiStream(
  endpoint: string,
  onDelta?: (fullText: string) => void
) {
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 取消信号，用于用户主动中断
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (body: unknown): Promise<string> => {
      setReply("");
      setError(null);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        // 非流式错误（如 503 未配置 key / 400 参数错误）→ 读 JSON
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => null);
          const msg = data?.error ?? `请求失败（HTTP ${res.status}）`;
          setError(msg);
          setStreaming(false);
          return "";
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        // 逐行解析 SSE 帧
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          // 保留最后一段不完整行
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;

            try {
              const obj = JSON.parse(payload) as {
                text?: string;
                done?: boolean;
                error?: string;
              };
              if (obj.error) {
                setError(obj.error);
                break;
              }
              if (typeof obj.text === "string") {
                full += obj.text;
                setReply(full);
                onDelta?.(full);
              }
            } catch {
              // 非 JSON 帧，忽略
            }
          }
        }

        return full;
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          // 用户主动中断，不算错误
          return "";
        }
        const msg = e instanceof Error ? e.message : "网络错误";
        setError(msg);
        return "";
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [endpoint, onDelta]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { reply, streaming, error, send, stop };
}
