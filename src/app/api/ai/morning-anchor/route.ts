import type { NextRequest } from "next/server";
import {
  MODEL_FLASH,
  isDeepSeekConfigured,
  notConfiguredResponse,
  chatStream,
} from "@/lib/deepseek";

/**
 * 晨间心锚（Morning Anchor）AI 凝练
 * POST /api/ai/morning-anchor → SSE 流式（text/event-stream）
 * body: {
 *   date?: string,                       // "2026-09-10"
 *   yesterdayUnfinished?: string[],      // 昨日未完成任务标题
 *   blackholeComment?: string,           // 昨日黑洞 AI 警示
 *   blackholeMinutes?: number,           // 昨日黑洞总时长
 *   lessons?: { taskTitle, text }[],     // 昨日踩坑教训
 *   bedtimeReflection?: string,          // 昨晚睡前感悟
 *   morningPlan?: string,                // 今日晨间计划
 *   now?: string                         // "周四 09:30"
 * }
 *
 * 输出严格两行 JSON：
 * { "slogan": "≤15字动作断言", "action": "昨日卡点 + 今日时间锚点" }
 */

interface LessonInput {
  taskTitle?: string;
  text?: string;
}

/** 从模型输出里稳健地抠出 JSON（容忍 ```json 包裹 / 前后废话） */
function extractJson(raw: string): { slogan: string; action: string } | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const slogan = String(obj.slogan ?? "").trim();
    const action = String(obj.action ?? "").trim();
    if (!slogan) return null;
    return { slogan, action };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let date = "";
  let unfinished: string[] = [];
  let comment = "";
  let blackholeMinutes = 0;
  let lessons: LessonInput[] = [];
  let bedtimeReflection = "";
  let morningPlan = "";
  let now = "";
  try {
    const body = await request.json();
    date = body.date ?? "";
    unfinished = Array.isArray(body.yesterdayUnfinished) ? body.yesterdayUnfinished : [];
    comment = body.blackholeComment ?? "";
    blackholeMinutes = Number(body.blackholeMinutes ?? 0) || 0;
    lessons = Array.isArray(body.lessons) ? body.lessons : [];
    bedtimeReflection = body.bedtimeReflection ?? "";
    morningPlan = body.morningPlan ?? "";
    now = body.now ?? "";
  } catch {
    return new Response(JSON.stringify({ error: "请求体需为 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const contextParts: string[] = [];
  contextParts.push(
    unfinished.length
      ? `昨日未完成的任务：${unfinished.join("、")}`
      : "昨日任务基本收尾，没有明显遗留。",
  );
  if (blackholeMinutes > 0) {
    // 该数值来自「休闲娱乐」象限（含计划外失控段），措辞与新象限命名保持一致
    contextParts.push(`昨日休闲娱乐（含失控时段）合计约 ${blackholeMinutes} 分钟。`);
  }
  if (comment) contextParts.push(`昨日黑洞警示：${comment}`);
  if (lessons.length) {
    contextParts.push(
      `昨日踩坑教训：${lessons.map((l) => `${l.taskTitle ?? ""} — ${l.text ?? ""}`).join("；")}`,
    );
  }
  if (bedtimeReflection) contextParts.push(`昨晚睡前感悟：${bedtimeReflection}`);
  if (morningPlan) contextParts.push(`今日原定晨间计划：${morningPlan}`);

  const userContent = `现在是 ${now || date || "今天早上"}。

【昨日之镜给到的事实】
${contextParts.join("\n")}

请据此凝练今天的「晨间心锚」。`;

  const system = [
    "你是 FlowMirror 的「晨间教练」——擅长把昨日的复盘事实压缩成一句能立刻照做的行动锚点。",
    "先在脑内想清楚，然后**只输出**下面这个 JSON；不要在正文里写任何推理、解释、思考过程，也不要包裹 Markdown 代码块：",
    '{"slogan":"...","action":"..."}',
    "· slogan：12~15 个汉字的动作断言（祈使句或断言句），必须直指昨日卡点，不要空泛口号（禁止「加油」「努力」「坚持」这类词）。",
    "· action：25~45 字，说清两件事——① 昨日卡点是什么（具体到行为）；② 今日几点前做什么（必须带明确时间锚点，如「10:00 前」「午休前 10 分钟」）。",
    "· **只准使用上面【昨日之镜给到的事实】里出现过的任务名**。没有给到具体任务时，不要编造任务名，改用描述性的说法（如「昨天那件一直没收尾的事」）。",
    "再次强调：你的回复内容必须**只有一个 JSON 对象**，第一个字符是 {，最后一个字符是 }。",
  ].join("\n");

  /**
   * ⚠️ **刻意没有任何兜底文案。**
   *
   * 早先这里写死过 `slogan: "不等状态，先动十分钟"` +
   * `action: 昨日「${unfinished[0]}」还悬着——…`，本意是"模型抽风时也别空着"。
   * 结果是灾难性的：它是一条**长得和真心锚一模一样**的编造内容，会被落库、
   * 会跨设备同步、会一直挂在卡片最上方 —— 用户完全无法分辨
   * 「这是系统编的」还是「这是我昨天写的」。更糟的是它把任务名硬塞进模板，
   * 于是一旦上游传来过一条历史脏任务，那句话就永远带着那个陌生任务名。
   *
   * 现在改为：模型没给出有效内容 → 明确报错。宁可空着让用户点一次重试，
   * 也不替他编一句他自己从没说过的话。
   */
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
      let buffer = "";
      let produced = false;
      try {
        for await (const delta of chatStream(messages, {
          model: MODEL_FLASH,
          temperature: 0.6,
          // 注意：deepseek-v4-flash 是推理模型，max_tokens 需同时覆盖 reasoning + content。
          // 预算过小（如 300）会被思考过程吃光，导致 content 为空、finish_reason=length。
          maxTokens: 1500,
        })) {
          if (delta) {
            produced = true;
            buffer += delta;
          }
        }
        // 模型返回空 / 非法 JSON → **如实报错，不编内容**
        const parsed = produced ? extractJson(buffer) : null;
        if (parsed) {
          send({ text: JSON.stringify(parsed) });
        } else {
          send({ error: "AI 未能凝练出心锚（模型未返回有效内容），请重试或自己写一句" });
        }
        send({ done: true });
      } catch (err) {
        send({ error: "AI 凝练服务暂时不可用，请重试或自己写一句" });
        send({ done: true });
        console.warn("[FlowMirror] 晨间心锚生成异常：", err);
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

/**
 * 无参 GET 已**刻意移除**。
 *
 * 它以前会返回一条写死的静态心锚（"不等状态，先动十分钟"），
 * 于是任何一次外部探测 / 手滑刷新都能拿到一句"看起来像心锚"的编造内容。
 * 心锚只能由「真实昨日事实 + 模型凝练」产生，不存在"降级样本"这种东西。
 */
