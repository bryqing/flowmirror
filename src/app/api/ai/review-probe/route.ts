import type { NextRequest } from "next/server";
import {
  MODEL_FLASH,
  isDeepSeekConfigured,
  notConfiguredResponse,
  toSseResponse,
} from "@/lib/deepseek";

/**
 * 微复盘追问：基于某个任务 + 已有复盘，生成 1-3 个引导式追问
 * POST /api/ai/review-probe  →  SSE 流式（text/event-stream）
 * body: { taskTitle, category, note, blockerTags, lessonTags }
 */
export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let body: {
    taskTitle?: string;
    category?: string;
    note?: string;
    blockerTags?: string[];
    lessonTags?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体需为 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const taskTitle = body.taskTitle?.trim() || "未命名任务";
  const note = body.note?.trim() || "";
  const blockers = (body.blockerTags ?? []).join("、") || "未填写";
  const lessons = (body.lessonTags ?? []).join("、") || "未填写";

  return toSseResponse(
    [
      {
        role: "system",
        content:
          "你是 FlowMirror 的「微复盘追问官」。用户刚完成一个任务并做了简短复盘，你的职责是提出 1-3 个真正值得思考的追问，帮他沉淀可复用的经验。要求：① 追问要具体、直击本质，避免「你感觉怎么样」这类空泛问题；② 每个追问一句话，不超过 25 字；③ 用「1. 2. 3.」编号，纯文本输出，不要多余解释；④ 至少一个问题围绕「下次怎么做得更快/更好」，至少一个问题围绕「这次踩了什么坑」。",
      },
      {
        role: "user",
        content: `任务：${taskTitle}\n我的复盘记录：${note || "（无文字记录）"}\n卡点标签：${blockers}\n经验标签：${lessons}\n\n请给我几个追问，帮我沉淀经验。`,
      },
    ],
    { model: MODEL_FLASH, temperature: 0.6, maxTokens: 300 }
  );
}
