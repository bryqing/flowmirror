import type { NextRequest } from "next/server";
import {
  MODEL_FLASH,
  isDeepSeekConfigured,
  notConfiguredResponse,
  chatStream,
} from "@/lib/deepseek";

/**
 * 昨日黑洞「止血方案」AI 锦囊
 * POST /api/ai/blackhole-tactic → SSE 流式（text/event-stream）
 * body: {
 *   slices: { start, end, label, runaway?, minutes? }[],
 *   totalMinutes: number,
 *   comment?: string,
 *   lessons?: { taskTitle, text }[],
 *   now?: string
 * }
 *
 * 输出三段：【失控溯源】【止血方案】【今晚防线】
 */

/** 直接返回静态 SSE 文本（不调用模型，用于降级场景） */
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

interface SliceInput {
  start?: string;
  end?: string;
  label?: string;
  runaway?: boolean;
}

interface LessonInput {
  taskTitle?: string;
  text?: string;
}

/** 计算切片时长（分钟），解析失败返回 null */
function sliceMinutes(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let slices: SliceInput[] = [];
  let comment = "";
  let lessons: LessonInput[] = [];
  let now = "";
  try {
    const body = await request.json();
    slices = Array.isArray(body.slices) ? body.slices : [];
    comment = body.comment ?? "";
    lessons = Array.isArray(body.lessons) ? body.lessons : [];
    now = body.now ?? "";
  } catch {
    return new Response(JSON.stringify({ error: "请求体需为 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 降级：昨日无任何黑洞切片
  if (slices.length === 0) {
    return staticSse(
      "【失控溯源】\n昨日没有记录到计划外的黑洞时段——这一天你守住了注意力。\n\n【保护方案】\n无需额外方案。保持当前的环境设计（手机隔离、通知关闭、任务拆小），把这份「无黑洞」的状态作为基准线延续下去。\n\n【今晚防线】\n睡前花 1 分钟回顾：是哪几个具体动作帮你挡住了诱惑？把它们写进明天的 SOP。"
    );
  }

  const total = slices.reduce((sum, s) => sum + (sliceMinutes(s.start, s.end) ?? 0), 0);
  const runawayCount = slices.filter((s) => s.runaway).length;

  const sliceLines = slices.map((s, i) => {
    const mins = sliceMinutes(s.start, s.end);
    const dur = mins != null ? `${mins} 分钟` : "时长未知";
    const flag = s.runaway ? "【失控段】" : "";
    return `${i + 1}. ${s.start ?? "--:--"}–${s.end ?? "--:--"}（${dur}）${s.label ?? "未命名"}${flag}`;
  });

  const lessonLines = lessons.length
    ? `\n\n【昨日已沉淀的踩坑教训】\n${lessons
        .map((l) => `· ${l.taskTitle ?? ""}：${l.text ?? ""}`)
        .join("\n")}`
    : "";

  const userContent = `现在是 ${now || "今天"}。这是我昨日的时间黑洞记录，共 ${slices.length} 段、合计 ${total} 分钟，其中失控段 ${runawayCount} 段：

${sliceLines.join("\n")}${comment ? `\n\n昨日 AI 警示：${comment}` : ""}${lessonLines}

请针对这些失控诱因，帮我设计今日的注意力保护方案。`;

  const system = [
    "你是 FlowMirror 的「时间黑洞教练」——擅长从行为记录里定位分心诱因，并给出可立即执行的注意力保护方案。",
    "严格按以下三个维度输出，用中文方括号标题分段，正文用简洁短句或短列表：",
    "①【失控溯源】：从时间分布与场景里指出真正的诱因（如午后低谷、夜间独处、无倒计时、特定 App 触发），要具体点出是哪一段、什么模式。",
    "②【保护方案】：给出 2~3 条今天就能做的具体动作，必须可执行、可验证（如「21:00 把手机放到客厅充电」「午休前定 10 分钟倒计时」），不要空泛口号。",
    "③【今晚防线】：针对最危险的那个时段，给一条最关键的物理隔离或环境设计建议。",
    "要求：只输出纯文本，不堆砌 Markdown 符号；语气温和、务实、直接，像一位靠谱的成长教练；总长度控制在 350 字以内。",
  ].join("\n");

  // 兜底文案：模型偶发返回空内容时使用（DeepSeek 对部分行为类表述会间歇性返回空）
  const fallback = `【失控溯源】
昨日共记录 ${slices.length} 段黑洞、合计约 ${total} 分钟，其中失控 ${runawayCount} 段。真正需要警惕的往往不是"玩"本身，而是那几段没有倒计时、也没有明确结束点的时段——它们最容易越滚越大。

【保护方案】
1. 今日先把最危险的那一段「装上刹车」：开始前定好倒计时，响铃即停，别靠意志力续命。
2. 把手机在关键时段放到另一个房间或抽屉里——物理距离比自控更可靠。
3. 每完成一段深度工作，安排 5 分钟主动恢复（起身喝水/远眺），用主动休息替代被动刷屏。

【今晚防线】
针对夜间高风险时段，提前设一个 21:00 的物理隔离动作：把手机插上充电器放到客厅，用纸质书或冥想替代入睡前的屏幕时间。环境改造一次，收益长期有效。`;

  const encoder = new TextEncoder();
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: userContent },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      let produced = false;
      try {
        for await (const delta of chatStream(messages, {
          model: MODEL_FLASH,
          temperature: 0.5,
          maxTokens: 800,
        })) {
          if (delta) {
            produced = true;
            send({ text: delta });
          }
        }
        // 模型返回空（内容过滤 / 偶发异常）→ 补发兜底方案，避免前端空白
        if (!produced) send({ text: fallback });
        send({ done: true });
      } catch (err) {
        // 流式途中抛错：若尚未产出任何内容，退回兜底方案
        if (!produced) send({ text: fallback });
        else send({ error: err instanceof Error ? err.message : "未知错误" });
        send({ done: true });
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
