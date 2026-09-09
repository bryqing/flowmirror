import type { NextRequest } from "next/server";
import {
  MODEL_FLASH,
  isDeepSeekConfigured,
  notConfiguredResponse,
  toSseResponse,
} from "@/lib/deepseek";

/**
 * AI 拓展思路：围绕一条灵感做维度拆解 / 反思提示 / 落地建议
 * POST /api/ai/expand-thought  →  SSE 流式（text/event-stream）
 * body: { content: string }   // 原始想法
 * 返回：流式拓展文本（前端消费后持久化到 thoughts.ai_expansion）
 */
export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let content: string;
  try {
    const body = await request.json();
    content = body.content;
  } catch {
    return new Response(JSON.stringify({ error: "请求体需为 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!content || !content.trim()) {
    return new Response(JSON.stringify({ error: "content 不能为空" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return toSseResponse(
    [
      {
        role: "system",
        content:
          "你是 FlowMirror 的「灵感拓展助手」。用户记录了一条闪念/想法，你的职责是围绕它做有价值的拓展，帮他把一个模糊念头变成可行动的洞察。要求：① 从三个维度展开——「本质拆解」（这个想法背后是什么）、「反思提示」（一个值得追问自己的问题）、「落地建议」（一个今天就能做的最小动作）；② 每个维度一行，用小标题「本质拆解 / 反思提示 / 落地建议」开头；③ 语气克制、务实，不鸡汤、不空泛；④ 总长度控制在 180 字以内；⑤ 纯文本输出，不用 Markdown 加粗或列表符号。",
      },
      {
        role: "user",
        content: `我刚刚记下的一条灵感：${content.trim()}\n\n请帮我拓展思路。`,
      },
    ],
    { model: MODEL_FLASH, temperature: 0.7, maxTokens: 400 }
  );
}
