import { QUADRANT_META, type ParsedCommand, type Quadrant } from "./types";

/**
 * 自然语言命令解析器（第一阶段：规则引擎原型）
 * 支持：
 *  - 新增任务："明天上午10点整理报表"
 *  - 改期顺延："把下午方案推迟到明天14点"
 *  - 计划外黑洞："刷半小时视频" / "摸鱼20分钟"
 *  - 熔断机制："今天太累了，先躺平"
 */

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 30,
};

function parseCnNum(token: string): number | null {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  if (token === "半") return 30;
  // 十 / 十二 / 二十 等简单中文数字
  if (token.includes("十")) {
    const [tensStr, onesStr] = token.split("十");
    const tens = tensStr === "" ? 1 : (CN_NUM[tensStr] ?? NaN);
    const ones = onesStr === "" || onesStr === undefined ? 0 : (CN_NUM[onesStr] ?? NaN);
    if (Number.isNaN(tens) || Number.isNaN(ones)) return null;
    return tens * 10 + ones;
  }
  return CN_NUM[token] ?? null;
}

/** 提取时长（分钟）：半小时 / 20分钟 / 一个小时 */
function extractDuration(text: string): number | null {
  if (/半小时/.test(text)) return 30;
  const m = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*(个)?\s*(小时|分钟|分)/);
  if (m) {
    const n = parseCnNum(m[1]);
    if (n === null) return null;
    if (m[3] === "小时") return n * 60;
    return n; // 分钟 / 分
  }
  return null;
}

/** 提取时刻："上午10点" / "14:30" / "下午3点半" */
function extractClock(text: string): string | null {
  const colon = text.match(/(\d{1,2})[：:](\d{1,2})/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const mm = parseInt(colon[2], 10);
    if (h <= 23 && mm <= 59) return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const m = text.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([0-9]+|[一二两三四五六七八九十]+)\s*[点時时](\s*([0-9]+|[一二两三四五六七八九十]+)\s*分)?/);
  if (m) {
    let h = parseCnNum(m[2]);
    if (h === null || h > 23) return null;
    const period = m[1];
    if ((period === "下午" || period === "傍晚" || period === "晚上") && h < 12) h += 12;
    if (period === "中午" && h < 11) h = 12;
    if (period === "凌晨" && h === 12) h = 0;
    let mm = 0;
    if (m[4]) {
      const parsed = parseCnNum(m[4].trim());
      if (parsed !== null) mm = parsed;
    }
    if (/点半/.test(text)) mm = 30;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return null;
}

/** 提取日期指向 */
function extractDay(text: string): string {
  if (/后天/.test(text)) return "后天";
  if (/明天|明日|明儿/.test(text)) return "明天";
  if (/今晚|今天|今日|今儿/.test(text)) return "今天";
  return "今天";
}

const BLACKHOLE_KEYWORDS =
  /刷.*(视频|短视频|手机|抖音|b站|B站|微博|小红书|朋友圈|剧)|摸鱼|追剧|看剧|打游戏|玩游戏|游戏|发呆|闲逛|刷会|躺平刷|放空/;
const FUSE_KEYWORDS = /太累|累瘫|躺平|摆烂|熔断|不想动|扛不住|歇了|歇一歇|电量耗尽|emo/;
const RESCHEDULE_KEYWORDS = /推迟|顺延|改到|延后|延期|挪到|改期|换到/;
const TASK_NOISE =
  /把|将|一下|去|帮我|给我|记得|要|得|安排|计划|明天|后天|今天|今晚|上午|下午|早上|晚上|中午|凌晨|傍晚|点|分|小时|分钟|个|半|的|了|到|\d+/g;

/* ============================================================
   四象限本地判定器
   ------------------------------------------------------------
   命令条是「一句话即时录入」，不能等 AI（DeepSeek 单次 5~14s）。
   因此这里先用规则给出**瞬时**判定，规则本身由 `QUADRANT_META` 的
   definition/hint 拆解而来（与 `/api/ai/parse-tasks` 的系统提示词同源），
   命中不了明确信号时标记 `confident: false`，交由上层异步调 AI 复核。

   判定顺序 = 优先级，刻意排成 q1 → q4 → q3 → q2：
   - q1 有硬性截止/卡住别人，最该抢占；
   - q4 娱乐信号最具体（刷/游戏/追剧/冥想），若放到后面会被「有空」这类
     延后词抢走（"有空刷刷视频" 应归娱乐而非待执行清单）；
   - q3 的延后/探索词次之（"下个月开小红书店" → 待执行清单）；
   - q2 的主线工作动词垫底（"整理下周选题文案" → 日常工作）。
   ============================================================ */

/** q1 紧急重要：硬性截止、今天必须完成、卡住别人的事 */
const Q1_SIGNALS =
  /紧急|急事|加急|立刻|立即|马上|尽快|今天必须|今日必须|今天之内|今日之内|截止|deadline|ddl|催|催办|上线|发布|交付|答辩|面试|述职|汇报材料|卡住别人|等结果|阻塞|blocked|故障|宕机|线上问题|线上事故|事故|报错|返工/;

/** q4 休闲娱乐：休息放松与娱乐消遣（平台名需与「刷/看」同现，避免误伤工作类） */
const Q4_SIGNALS =
  /休息|放松|散步|冥想|午睡|小睡|午休|躺(一会|一下|着)|喝茶|看电影|听歌|唱歌|逛街|购物|打牌|泡脚|遛狗|发呆|摸鱼|追剧|看剧|打游戏|玩游戏|游戏|刷(短视频|视频|手机|抖音|微博|朋友圈|小红书|b站|B站|剧)|短视频|抖音|放空|闲逛|躺平|按摩|睡觉/;

/** q3 待执行清单：暂不紧急、可延后抽空处理的杂项与探索 */
const Q3_SIGNALS =
  /下个月|下月|下个季度|下季度|明年|以后|有空|抽空|闲时|找时间|考虑|研究|了解|探索|看看|调研一下|暂不|暂时|稍后|待定|不急|不着急|想尝试|尝试一下|探索性|慢慢来|改天/;

/** q2 日常工作：主线推进、交付、选题策划与持续推进类 */
const Q2_SIGNALS =
  /撰写|编写|写作|写|整理|复盘|方案|报告|评审|推进|选题|文案|对接|沟通|邮件|审批|排期|调研|设计|开发|编码|需求|会议|周会|日报|周报|月报|规划|策划|内容|更新|维护|优化|分析|数据|表格|文档|ppt|搭建|制作|准备|跟进|统计|汇总/;

/**
 * 对一句话做本地象限判定。
 * 返回 `confident: false` 表示没命中任何明确信号（只是兜底归入 q3），
 * 上层可据此决定是否再问一次 AI。
 */
export function classifyQuadrant(text: string): { quadrant: Quadrant; confident: boolean } {
  const t = text.trim();
  if (!t) return { quadrant: "q3", confident: false };
  if (Q1_SIGNALS.test(t)) return { quadrant: "q1", confident: true };
  if (Q4_SIGNALS.test(t)) return { quadrant: "q4", confident: true };
  if (Q3_SIGNALS.test(t)) return { quadrant: "q3", confident: true };
  if (Q2_SIGNALS.test(t)) return { quadrant: "q2", confident: true };
  // 无明确信号：按「拿不准就归待执行清单」的既有纪律兜底，并标记为低置信
  return { quadrant: "q3", confident: false };
}

export function parseCommand(raw: string): ParsedCommand {
  const text = raw.trim();
  if (!text) return { intent: "unknown", summary: "试着说：明天上午10点整理报表" };

  // 1) 熔断机制
  if (FUSE_KEYWORDS.test(text) && !/刷|视频|游戏/.test(text)) {
    return {
      intent: "fuse",
      summary: "一键冷冻今日剩余待办，切换治愈关怀模式 —— 休息不是失败，是战略撤退。",
    };
  }

  // 2) 计划外黑洞
  if (BLACKHOLE_KEYWORDS.test(text)) {
    const minutes = extractDuration(text) ?? 30;
    const title = /摸鱼/.test(text)
      ? "摸鱼放空"
      : /剧/.test(text)
        ? "追剧"
        : /游戏/.test(text)
          ? "打游戏"
          : "刷短视频";
    return {
      intent: "blackhole",
      title,
      minutes,
      summary: `归类为【休闲娱乐】，启动 ${minutes} 分钟倒计时，到点弹出刹车强提醒。`,
    };
  }

  // 3) 改期顺延
  if (RESCHEDULE_KEYWORDS.test(text)) {
    const day = extractDay(text);
    const time = extractClock(text) ?? undefined;
    const keyword = text
      .replace(RESCHEDULE_KEYWORDS, "")
      .replace(TASK_NOISE, "")
      .replace(/[，,。.!！?？]/g, "")
      .trim()
      .slice(0, 8) || "该任务";
    return {
      intent: "reschedule",
      keyword,
      dayLabel: day,
      time,
      summary: `将「${keyword}」顺延至${day}${time ? ` ${time}` : ""}，自动更新时间轴。`,
    };
  }

  // 4) 新增任务（含时刻或动作词即视为任务）
  const time = extractClock(text) ?? undefined;
  const day = extractDay(text);
  const title = text
    .replace(/^(帮我|我要|我想|记得|安排|计划|新增|添加|新建)\s*/, "")
    .replace(TASK_NOISE, "")
    .replace(/[，,。.!！?？]/g, "")
    .trim();

  if (title.length >= 2) {
    // 按 QUADRANT_META 判据本地判定象限 —— 不再一律塞进 q1。
    // ⚠️ 判定用**原文**而不是 title：TASK_NOISE 会把「个」这类字一并抹掉
    //    （"下个月开小红书店" → "下月开小红书店"），拿它判定会丢掉「暂缓」信号。
    const { quadrant, confident } = classifyQuadrant(text);
    return {
      intent: "add",
      title,
      dayLabel: day,
      time,
      quadrant,
      confident,
      summary: `新增任务「${title}」，归入【${QUADRANT_META[quadrant].label}】${day !== "今天" ? ` ${day}` : ""}${time ? ` ${time}` : ""}。`,
    };
  }

  return {
    intent: "unknown",
    summary: "没太听懂 —— 可以说：明天上午10点整理报表 / 刷半小时视频 / 今天太累了先躺平",
  };
}

/** 命令栏快捷示例 */
export const COMMAND_SUGGESTIONS = [
  "明天上午10点整理报表",
  "把下午方案推迟到明天14点",
  "刷半小时视频",
  "今天太累了，先躺平",
];
