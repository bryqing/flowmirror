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
