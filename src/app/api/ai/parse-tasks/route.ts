import type { NextRequest } from "next/server";
import {
  MODEL_FLASH,
  chat,
  isDeepSeekConfigured,
  notConfiguredResponse,
} from "@/lib/deepseek";
import {
  QUADRANT_META,
  QUADRANT_ORDER,
  coerceQuadrant,
  isTaskPriority,
  type AiParsedTask,
  type Quadrant,
  type TaskPriority,
} from "@/lib/types";

/**
 * AI 战局速记 · 智能拆解
 * POST /api/ai/parse-tasks
 * body: { text: string }            —— 口述/粘贴的一大段自然语言
 * 返回: { tasks: [{ title, quadrant: "q1"|"q2"|"q3"|"q4", priority: "high"|"medium"|"low" }] }
 *
 * 设计要点（与项目既有 AI 约定保持一致）：
 *  1. **复用 `lib/deepseek.ts` 的 `chat()`**，不直连 API —— 模型名、key 读取、
 *     超时行为统一在封装层维护（直连 + 硬编码模型名会在换模型时静默失效）。
 *  2. `deepseek-v4-flash` 是**推理模型**：`max_tokens` 必须同时容纳 reasoning +
 *     content。预算过小会被思考过程吃光 → content 空串（看似"内容过滤"，实为 token 不够）。
 *     对策：system prompt 显式要求「只在脑内推理、只输出 JSON」+ maxTokens 给到 1500。
 *  3. **不依赖 `response_format: json_object`**：让模型吐 JSON 文本，再用下面的
 *     `extractTasks()` 剥代码块 + 截取首尾花括号容错解析，并对每个字段做校验与归一化。
 *     即使模型多说了几句解释、或把象限写成「1」「紧急重要」，也能被正确吸收。
 *  4. 任何失败都返回结构化 JSON 错误（前端据此降级到按行本地拆分），绝不返回空的
 *     黑盒错误体。
 */

/** 单次最多拆出的任务数：防模型把一段话拆成几十条（也保护后续批量入库） */
const MAX_TASKS = 20;
/** 输入上限：超出截断，避免超长 prompt 把推理时间推过 Netlify 函数超时 */
const MAX_INPUT_CHARS = 4000;
/** 标题最大长度 */
const MAX_TITLE_CHARS = 40;

/** 四象限判据 —— 与 `lib/types.ts` 的 QUADRANT_META 同源，改名/改语义只需改一处 */
const QUADRANT_RULES = QUADRANT_ORDER.map(
  (q, i) => `${i + 1}. ${q} ${QUADRANT_META[q].label}：${QUADRANT_META[q].definition}`
).join("\n");

const SYSTEM_PROMPT = [
  "你是 FlowMirror 的「战局速记」拆解助手，负责把用户口述或粘贴的一大段自然语言，拆成一条条可执行的任务，并为每条判定所属象限。",
  "",
  "【四象限判据】",
  QUADRANT_RULES,
  "",
  "【判定顺序】",
  "① 有硬性截止、今天必须完成、或卡住别人的 → q1；",
  "② 属于主线工作与产出、需要持续推进的 → q2；",
  "③ 暂不紧急、可延后抽空做的杂项或探索性尝试 → q3；",
  "④ 纯休息放松与娱乐消遣 → q4。",
  "两者之间拿不准时，一律归入 q3，不要臆测。",
  "",
  "【优先级】",
  "high = 今天必须完成或阻塞他人；medium = 本周内推进即可；low = 可长期搁置、纯探索或休闲。",
  "",
  "【拆解纪律】",
  "· 只提取原文中真实存在的事项，绝不虚构或脑补用户没提过的任务；",
  "· 一条事项只输出一条任务，不要把同一条拆成多条近似重复项；",
  "· 标题用动宾短语，12 字以内最理想，去掉「记得」「帮我」「然后」这类语气词与序号；",
  "· 保留用户原本的表述语言（中文就是中文）；",
  "· 若整段话里没有任何可执行事项，返回空数组。",
  "",
  "【输出格式】",
  "先在脑内推理，然后**只输出**下面这个 JSON 对象；不要写任何解释、思考过程，也不要包裹 Markdown 代码块。",
  "第一个字符必须是 {，最后一个字符必须是 }：",
  '{"tasks":[{"title":"任务名称","quadrant":"q1","priority":"high"}]}',
].join("\n");

/** 统一 JSON 响应（禁用缓存，避免代理/浏览器缓存住解析结果） */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** 清洗标题：去序号/项目符号前缀、去包裹引号、限长 */
function cleanTitle(value: unknown): string {
  return String(value ?? "")
    .replace(/^[\s\d.、,，)）\-·•*"'「」]+/, "")
    .trim()
    .slice(0, MAX_TITLE_CHARS);
}

/**
 * 归一化模型返回：接受 {tasks:[...]} / [...] / {result:[...]} 等形态，
 * 逐条校验字段、按标题去重、截断到 MAX_TASKS。
 */
function normalizeTasks(value: unknown): AiParsedTask[] {
  let list: unknown[] = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const candidate = obj.tasks ?? obj.result ?? obj.data ?? obj.items;
    if (Array.isArray(candidate)) list = candidate;
  }

  const out: AiParsedTask[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    const title = cleanTitle(row.title ?? row.task ?? row.name);
    if (!title) continue;

    // 去重：忽略空白与标点差异后的标题相同即视为重复
    const dedupeKey = title.replace(/[\s，。、,.!！?？]/g, "");
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const quadrant: Quadrant =
      coerceQuadrant(row.quadrant ?? row.category ?? row.q) ?? "q3";
    const priority: TaskPriority = isTaskPriority(row.priority) ? row.priority : "medium";

    out.push({ title, quadrant, priority });
    if (out.length >= MAX_TASKS) break;
  }

  return out;
}

/** 从模型文本里抽出 JSON 并归一化；完全无法解析时返回 null */
function extractTasks(raw: string): AiParsedTask[] | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  if (!cleaned) return null;

  // 优先按「首 { → 末 }」截取对象；失败再退回按数组截取
  const candidates: string[] = [];
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) candidates.push(cleaned.slice(objStart, objEnd + 1));

  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(cleaned.slice(arrStart, arrEnd + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const tasks = normalizeTasks(parsed);
      // 解析成功即返回（空数组合法：说明原文没有可执行事项）
      return tasks;
    } catch {
      // 换下一个候选片段
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!isDeepSeekConfigured()) return notConfiguredResponse();

  let text = "";
  try {
    const body = await request.json();
    text = typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text : "";
  } catch {
    return json({ error: "请求体需为 JSON" }, 400);
  }

  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return json({ error: "请先输入或粘贴要拆解的内容" }, 400);
  }
  const input =
    trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      { model: MODEL_FLASH, temperature: 0.2, maxTokens: 1500 }
    );

    const tasks = extractTasks(raw);
    if (tasks === null) {
      // 把模型原始输出截断回传，便于线上直接定位（不再出现无法诊断的黑盒）
      console.warn("[FlowMirror] parse-tasks 返回无法解析：", raw.slice(0, 300));
      return json(
        { error: "AI 返回格式无法解析，请重试", raw: raw.slice(0, 300) },
        502
      );
    }

    return json({ tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[FlowMirror] parse-tasks 调用失败：", message);
    return json({ error: "AI 解析失败，请稍后重试", detail: message }, 502);
  }
}
