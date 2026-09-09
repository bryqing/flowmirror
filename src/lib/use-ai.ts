"use client";

import { useCallback, useState } from "react";

/**
 * AI 调用 hook：封装对本地 /api/ai/* 端点的 fetch，统一处理 loading/error
 * 返回 { loading, error, result, run }
 */
export function useAi<T>(endpoint: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const run = useCallback(
    async (body: unknown): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? `请求失败（HTTP ${res.status}）`);
          return null;
        }
        setResult(data as T);
        return data as T;
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
