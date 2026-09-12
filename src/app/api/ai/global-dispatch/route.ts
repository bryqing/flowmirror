import type { NextRequest } from "next/server";
import {
  MODEL_FLASH,
  isDeepSeekConfigured,
  notConfiguredResponse,
  toSseResponse,
} from "@/lib/deepseek";
import {
  CATEGORY_META,
  QUADRANT_META,
  QUADRANT_ORDER,
  type TaskCategory,
} from "@/lib/types";

/**
 * 象限中文标签 —— 统一取自 lib/types.ts 的 CATEGORY_META，
 * 避免各处硬编码副本在改名后失同步。
 */
function catLabel(category?: string): string {
  const meta = CATEGORY_META[category as TaskCategory];
  return meta?.label ?? category ?? "未分类";
}

/** 供模型对齐的四象限图例，如「Q1 紧急重要 / Q2 日常工作 / …」 */
const QUADRANT_LEGEND = QUADRANT_ORDER.map(
  (q) => `${q.toUpperCase()} ${QUADRANT_META[q].label}`
).join(" / ");

const STATUS_LABEL: Record<string, string> = {
  pending: "待办",
  "in-progress": "进行中",
  done: "已完成",
  frozen: "已冷冻",
};

/** 直接返回一段静态 SSE 文本（不调用模型，用于降级场景） */
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

interface TaskInput {
  title?: string;
  category?: string;
  status?: string;
  plannedDuration?: number;
  actualDuration?: number;
  tags?: string[];
}

/**
 * 全局战局 AI 调度分析（Global AI Tactician）
 * POST /api/ai/global-dispatch → SSE 流式（text/event-stream）
 * body: { tasks: TaskInput[], now: string }
 * 输出三维度：战局诊断 / 行动序列 / 熔断建议
 */
export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let tasks: TaskInput[];
  let now = "";
  try {
    const body = await request.json();
    tasks = body.tasks ?? [];
    now = body.now ?? "";
  } catch {
    return new Response(JSON.stringify({ error: "请求体需为 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(tasks)) {
    return new Response(JSON.stringify({ error: "tasks 需为数组" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 降级 1：无任何任务
  if (tasks.length === 0) {
    return staticSse(
      "【战局诊断】\n当前战局空无一物，没有可调度的任务。\n\n【行动序列】\n先把今天最重要的一件事写进象限——哪怕只是「列出三件要事」。空白本身也是一种拖延，先落一笔。\n\n【熔断建议】\n无需熔断。此刻唯一该断的是「继续空想」这个动作。"
    );
  }

  // 降级 2：所有任务均已完成或冷冻（无 active 任务）
  const active = tasks.filter(
    (t) => t.status === "pending" || t.status === "in-progress"
  );
  if (active.length === 0) {
    const doneCount = tasks.filter((t) => t.status === "done").length;
    const frozenCount = tasks.filter((t) => t.status === "frozen").length;
    return staticSse(
      `【战局诊断】\n今日战局已收束：${doneCount} 项完成${frozenCount ? `，${frozenCount} 项冷冻` : ""}，无待办残留。你已打满这一场。\n\n【行动序列】\n不必再冲刺。给自己一段高质量恢复，或复盘今天的时间去向——把「赢在哪里」写进微复盘。\n\n【熔断建议】\n无需熔断。此刻唯一该警惕的是「硬找事做」的惯性。`
    );
  }

  // 组装完整任务画像供模型研判
  const lines = tasks.map((t, i) => {
    const cat = catLabel(t.category);
    const status = STATUS_LABEL[t.status ?? ""] ?? t.status ?? "未知";
    const plan = t.plannedDuration ? `，计划 ${t.plannedDuration} 分钟` : "";
    const actual =
      t.actualDuration != null ? `，实际已耗 ${t.actualDuration} 分钟` : "";
    const tags = t.tags?.length ? `，标签：${t.tags.join("/")}` : "";
    return `${i + 1}. ${t.title ?? "未命名"}【${cat}】状态=${status}${plan}${actual}${tags}`;
  });

  const userContent = `现在是 ${now || "当前时刻"}。我的四象限战局如下（含已完成与冷冻项，用于判断整体负载）：\n${lines.join("\n")}\n\n请作为硬核战术指挥官，对我接下来的时间部署做三维度分析。`;

  const system = [
    "你是 FlowMirror 的「全局战局 AI 调度分析」——一个专业、务实、有战场直觉的战术指挥官。",
    `你基于用户当前四象限任务列表做全局调度研判。四象限定义：${QUADRANT_LEGEND}。`,
    "必须严格按以下三个维度输出，每个维度用中文方括号标题【战局诊断】【行动序列】【熔断建议】分段，正文用简洁的短句/短列表。",
    "①【战局诊断】：判断四象限负载是否合理，是否存在「精力透支」（Q1 紧急重要过载、无 Q4 休闲娱乐作为恢复）或「避重就轻」（Q2/Q4 占比过高而 Q1 的关键事项被搁置）。要具体点出失衡的象限。",
    "②【行动序列】：给出接下来 2~4 步的具体冲刺顺序，串联具体任务标题与番茄节奏（如「先用 25 分钟聚焦 X，休息 5 分钟后再推进 Y」）。只安排待办/进行中的任务，不要调度已完成项。",
    "③【熔断建议】：明确指出一项该果断放弃或冷冻的低价值、高摩擦任务，并给一句理由。若无明显该断的，就说「本次无需熔断」并说明为什么。",
    "要求：只输出纯文本，不堆砌 Markdown 符号；语气果断、务实，像战场简报，不鸡汤不废话；总长度控制在 400 字以内。",
  ].join("\n");

  return toSseResponse(
    [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    { model: MODEL_FLASH, temperature: 0.5, maxTokens: 900 }
  );
}
