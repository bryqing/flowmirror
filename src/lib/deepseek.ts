/**
 * DeepSeek 服务端封装（仅服务端代码使用）
 * - DeepSeek API 兼容 OpenAI 协议，base_url = https://api.deepseek.com
 * - 模型（2026-07-24 起）：deepseek-v4-flash（快/便宜/通用）、deepseek-v4-pro（强推理）
 * - API key 从服务端环境变量 DEEPSEEK_API_KEY 读取，绝不暴露给前端
 */
import OpenAI from "openai";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** 通用场景默认模型（战术锦囊 / 微复盘追问） */
export const MODEL_FLASH = "deepseek-v4-flash";
/** 深度推理场景（深夜深潜） */
export const MODEL_PRO = "deepseek-v4-pro";

let client: OpenAI | null = null;

export function isDeepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

function getClient(): OpenAI {
  if (!isDeepSeekConfigured()) {
    throw new Error("DeepSeek 未配置：缺少 DEEPSEEK_API_KEY 环境变量");
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
    });
  }
  return client;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekOptions {
  /** 模型，默认 deepseek-v4-flash */
  model?: string;
  /** 温度 0-2，默认 0.7（锦囊/追问偏收敛可用 0.5） */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
}

/**
 * 单轮对话（非流式）。返回文本内容。
 * 失败时抛出 Error，由调用方决定降级策略。
 */
export async function chat(
  messages: ChatMessage[],
  opts: DeepSeekOptions = {}
): Promise<string> {
  const c = getClient();
  const completion = await c.chat.completions.create({
    model: opts.model ?? MODEL_FLASH,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
    stream: false,
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return content.trim();
}

/**
 * 流式对话（供深夜深潜等需要打字机效果的多轮场景）。
 * 返回 async iterable of text delta。
 */
export async function* chatStream(
  messages: ChatMessage[],
  opts: DeepSeekOptions = {}
): AsyncGenerator<string> {
  const c = getClient();
  const stream = await c.chat.completions.create({
    model: opts.model ?? MODEL_FLASH,
    messages,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 2048,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/**
 * 把 chatStream 的结果包装成 SSE Response（text/event-stream）。
 * 每个增量一帧 `data: {"text": ...}`，结尾一帧 `data: {"done": true}`，
 * 出错时一帧 `data: {"error": ...}`。
 * 供所有流式 Route Handler 复用，避免重复写 ReadableStream 样板。
 */
export function toSseResponse(
  messages: ChatMessage[],
  opts: DeepSeekOptions = {}
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for await (const delta of chatStream(messages, opts)) {
          send({ text: delta });
        }
        send({ done: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "未知错误";
        send({ error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** 未配置 key 时的统一 503 响应（JSON） */
export function notConfiguredResponse(): Response {
  return new Response(
    JSON.stringify({ error: "DeepSeek 未配置（缺少 DEEPSEEK_API_KEY）" }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}
