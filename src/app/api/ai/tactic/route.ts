import type { NextRequest } from "next/server";
import {
  MODEL_FLASH,
  isDeepSeekConfigured,
  notConfiguredResponse,
  toSseResponse,
} from "@/lib/deepseek";

/** 直接返回一段静态 SSE 文本（不调用模型） */
function staticSse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

/**
 * 战术锦囊：输入当前四象限任务状态，输出极简执行 SOP + 避坑提醒
 * POST /api/ai/tactic  →  SSE 流式（text/event-stream）
 * body: { tasks: [{ title, category, status, plannedDuration }] }
 */
export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let tasks: unknown;
  try {
    const body = await request.json();
    tasks = body.tasks;
  } catch {
    return new Response(JSON.stringify({ error: "请求体需为 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return new Response(JSON.stringify({ error: "tasks 不能为空" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const pending = tasks.filter(
    (t: { status?: string }) => t.status === "pending" || t.status === "in-progress"
  );

  if (pending.length === 0) {
    // 无待办时直接返回静态提示（不走模型），仍以 SSE 输出保持前端消费统一
    return staticSse("今日没有待办任务。给自己一段高质量的休息，或复盘今天的时间去向。");
  }

  const summary = pending
    .map((t: { title?: string; category?: string; plannedDuration?: number }) => {
      const catLabel: Record<string, string> = {
        "deep-work": "深度工作",
        chore: "日常杂务",
        blackhole: "娱乐黑洞",
        rest: "休息恢复",
      };
      return `- ${t.title ?? "未命名"}（${catLabel[t.category ?? ""] ?? t.category ?? "未分类"}，计划 ${t.plannedDuration ?? "?"} 分钟）`;
    })
    .join("\n");

  return toSseResponse(
    [
      {
        role: "system",
        content:
          "你是 FlowMirror 的「战术锦囊」，一个克制、务实的效率教练。你的任务是根据用户当前待办，给出一个「极简开局动作」和一条「避坑提醒」。要求：① 只输出纯文本，不要 Markdown 标题或列表符号堆砌；② 语气简洁有力，像老兵指点新兵，不鸡汤、不废话；③ 总长度控制在 120 字以内；④ 先给「现在第一步该做什么」，再给「最可能卡住你的坑」。",
      },
      {
        role: "user",
        content: `我的当前待办：\n${summary}\n\n请给我一个战术锦囊。`,
      },
    ],
    { model: MODEL_FLASH, temperature: 0.5, maxTokens: 300 }
  );
}
