import { NextResponse, type NextRequest } from "next/server";
import { chat, MODEL_FLASH, isDeepSeekConfigured } from "@/lib/deepseek";

/**
 * 战术锦囊：输入当前四象限任务状态，输出极简执行 SOP + 避坑提醒
 * POST /api/ai/tactic
 * body: { tasks: [{ title, category, status, plannedDuration }] }
 */
export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) {
    return NextResponse.json(
      { error: "DeepSeek 未配置（缺少 DEEPSEEK_API_KEY）" },
      { status: 503 }
    );
  }

  let tasks: unknown;
  try {
    const body = await request.json();
    tasks = body.tasks;
  } catch {
    return NextResponse.json({ error: "请求体需为 JSON" }, { status: 400 });
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({ error: "tasks 不能为空" }, { status: 400 });
  }

  const pending = tasks.filter(
    (t: { status?: string }) => t.status === "pending" || t.status === "in-progress"
  );

  if (pending.length === 0) {
    return NextResponse.json({
      tactic: "今日没有待办任务。给自己一段高质量的休息，或复盘今天的时间去向。",
    });
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

  try {
    const tactic = await chat(
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

    return NextResponse.json({ tactic });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json({ error: `锦囊生成失败：${message}` }, { status: 502 });
  }
}
