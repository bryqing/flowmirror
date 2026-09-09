import type { NextRequest } from "next/server";
import {
  MODEL_PRO,
  isDeepSeekConfigured,
  notConfiguredResponse,
  toSseResponse,
  type ChatMessage,
} from "@/lib/deepseek";

/**
 * 深夜深潜：开放式认知对话（SSE 流式输出）
 * POST /api/ai/deep-dive
 * body: { messages: [{ role: "system"|"user"|"assistant", content }] }
 * 响应：text/event-stream，逐段推送 `data: {text}` 增量
 * 用 deepseek-v4-pro 强化推理，适合深夜低刺激场景下的认知深潜
 */
export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let messages: ChatMessage[];
  try {
    const body = await request.json();
    messages = body.messages;
  } catch {
    return new Response(JSON.stringify({ error: "请求体需为 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages 不能为空" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 强制注入系统人设（如果调用方未提供）
  const hasSystem = messages.some((m) => m.role === "system");
  const full: ChatMessage[] = hasSystem
    ? messages
    : [
        {
          role: "system",
          content:
            "你是 FlowMirror 的「深夜深潜」引导者，一个温和、深刻、不评判的认知伙伴。现在是深夜，用户在低刺激的烛光模式下想和你聊一些更本质的东西——关于时间的去向、注意力的结构、或人生的某个困惑。要求：① 语气平静、克制，像深夜的一盏灯；② 少用感叹号，不鸡汤，不空洞安慰；③ 倾向提出更本质的问题或视角，而不是急着给答案；④ 单次回复控制在 300 字以内。",
        },
        ...messages,
      ];

  return toSseResponse(full, { model: MODEL_PRO, temperature: 0.8, maxTokens: 800 });
}
