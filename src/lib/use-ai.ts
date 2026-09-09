"use client";

import { useCallback, useState } from "react";

/**
 * AI 调用 hook：封装对本地 /api/ai/* 端点的 fetch。
 * 同时支持两类响应：
 *   - JSON（非流式）：解析 body 后返回整个对象
 *   - SSE（text/event-stream 流式）：逐帧累加 `data: {"text":...}`，返回累积的纯文本
 *
 * 返回 { loading, error, result, run }
 * result 在流式场景下是累加后的字符串，在 JSON 场景下是解析后的对象。
 */
export function useAi(endpoint: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const run = useCallback(
    async (body: unknown): Promise<string | null> => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream, application/json",
          },
          body: JSON.stringify(body),
        });

        const contentType = res.headers.get("content-type") ?? "";

        // 错误处理：非 OK 时尝试读 JSON 错误信息
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const msg =
            (data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : null) ?? `请求失败（HTTP ${res.status}）`;
          setError(msg);
          return null;
        }

        // SSE 流式响应
        if (contentType.includes("text/event-stream") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let full = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
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
                  setResult(full);
                }
              } catch {
                // 非 JSON 帧，忽略
              }
            }
          }

          return full;
        }

        // JSON 非流式响应
        const data = (await res.json()) as Record<string, unknown>;
        const text = typeof data === "object" ? JSON.stringify(data) : String(data);
        setResult(text);
        return text;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "网络错误";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [endpoint]
  );

  return { loading, error, result, run };
}
