import type { DayMirror, HeatmapData, Task } from "./types";

/** 晨间唤醒金句（基于昨日反思提炼的一日行动锚点） */
export const MORNING_ANCHOR = {
  quote: "先写烂初稿，再迭代到好。",
  context: "昨日卡点在「完美开场」——今天不等状态，10:00 前先把复盘报告框架砸出来。",
  date: "9月8日 · 周二",
};

/** 今日任务时间轴 */
export const TODAY_TASKS: Task[] = [
  {
    id: "task-01",
    title: "撰写 Q3 产品复盘报告",
    status: "in-progress",
    category: "deep-work",
    scheduledTime: "09:30",
    plannedDuration: 90,
    timeSlices: [{ start: "09:30", end: "10:15", label: "报告框架搭建" }],
    microReviews: [],
    insights: [],
    sops: [
      "先写结论与三段故事线，再填数据",
      "断网 25 分钟，手机翻面扣在桌角",
      "烂初稿直接写，禁止回头改措辞",
    ],
    pitfalls: ["上次一上来就调排版，2 小时没写完 300 字"],
  },
  {
    id: "task-02",
    title: "回复客户邮件 & 审批流程",
    status: "done",
    category: "chore",
    scheduledTime: "11:00",
    plannedDuration: 30,
    actualDuration: 38,
    timeSlices: [{ start: "11:02", end: "11:40", label: "邮件与审批" }],
    microReviews: [
      {
        id: "mr-02",
        createdAt: "11:42",
        blockerTags: ["被打断"],
        lessonTags: ["批量处理"],
        note: "一封询价邮件拖进了聊天，以后杂务统一 30 分钟批处理。",
      },
    ],
    insights: ["杂务批处理比随时响应平均少花 12 分钟"],
    sops: ["先回紧急的 3 封，其余归档", "审批单一键过，不纠结措辞"],
    pitfalls: ["不要在杂务时段点开微信群"],
  },
  {
    id: "task-03",
    title: "午休刷短视频",
    status: "done",
    category: "blackhole",
    scheduledTime: "12:30",
    actualDuration: 30,
    timeSlices: [{ start: "12:30", end: "13:00", label: "刷短视频" }],
    microReviews: [
      {
        id: "mr-03",
        createdAt: "13:05",
        blockerTags: ["超时失控"],
        lessonTags: ["环境隔离"],
        note: "说好的 10 分钟……下午把手机放到抽屉里。",
      },
    ],
    insights: [],
    sops: [],
    pitfalls: ["躺着刷 = 必然超时，倒计时必须开声音"],
    blackholeMinutes: 30,
  },
  {
    id: "task-04",
    title: "准备周四方案评审：故事线初稿",
    status: "pending",
    category: "deep-work",
    scheduledTime: "14:00",
    plannedDuration: 120,
    timeSlices: [],
    microReviews: [],
    insights: [],
    sops: [
      "白板先画 5 页叙事流，不开 PPT",
      "每页只写一个核心观点句",
      "数据图表最后补，先借位占位",
    ],
    pitfalls: [
      "上次直接套模板，做了 40 页被批「没有观点」",
      "午后犯困，先冲一杯咖啡再开始",
    ],
  },
  {
    id: "task-05",
    title: "冥想 15 分钟 + 下楼散步",
    status: "pending",
    // 主动放松属于「休闲娱乐」，同时沿用该象限的倒计时刹车机制
    category: "blackhole",
    scheduledTime: "15:30",
    plannedDuration: 30,
    timeSlices: [],
    microReviews: [],
    insights: [],
    sops: ["4-7-8 呼吸三轮", "不带手机下楼"],
    pitfalls: [],
  },
  {
    id: "task-06",
    title: "整理本周报销单",
    status: "pending",
    // 杂项 → 待执行清单（暂不紧急，抽空处理）
    category: "rest",
    scheduledTime: "16:30",
    plannedDuration: 20,
    timeSlices: [],
    microReviews: [],
    insights: [],
    sops: ["发票拍照 → 统一贴入模板", "超过 20 分钟立刻停，明天续"],
    pitfalls: [],
  },
  {
    id: "task-07",
    title: "梳理本周工作主线与下周选题",
    status: "pending",
    category: "chore",
    scheduledTime: "17:00",
    plannedDuration: 40,
    timeSlices: [],
    microReviews: [],
    insights: [],
    sops: ["先罗列已推进项，再挑 3 个候选选题", "只定方向，不展开细节"],
    pitfalls: [],
  },
  {
    id: "task-08",
    title: "调研竞品新版定价页（探索性尝试）",
    status: "pending",
    category: "rest",
    scheduledTime: "21:30",
    plannedDuration: 30,
    timeSlices: [],
    microReviews: [],
    insights: [],
    sops: ["只看结构与话术，不做完整分析", "截图存档，结论留到明天"],
    pitfalls: [],
  },
];

/** 昨日之镜 */
export const YESTERDAY_MIRROR: DayMirror = {
  dateLabel: "9月7日 · 周一",
  completionRate: 0.71,
  doneCount: 5,
  totalCount: 7,
  deepWorkMinutes: 215,
  blackholeMinutes: 150,
  blackholeSlices: [
    { start: "12:30", end: "13:00", label: "刷短视频 · 午休" },
    { start: "17:15", end: "17:45", label: "游戏摸鱼" },
    { start: "21:00", end: "22:00", label: "刷短视频 · 失控段", runaway: true },
  ],
  blackholeComment:
    "夜间 21 点后为重度失控期，单段失控 60 分钟、占昨日黑洞 40%。今晚建议 21:00 把手机物理隔离到客厅。",
  memoryFragments: [
    { text: "外界的挑剔，只是内心心虚的放大镜。", source: "深夜认知深潜 · 第三轮" },
    { text: "先写烂初稿，再迭代到好——开场焦虑只能靠动手治。", source: "微复盘 · 方案初稿" },
    { text: "刷手机不是休息，是逃避；真正的恢复是散步和冥想。", source: "微复盘 · 午休黑洞" },
  ],
  mostTouching:
    "下午方案被否后，没有继续刷手机逃避，而是在白板前重画故事线——15 分钟就找到了真正的卡点。",
  lessons: [
    { taskTitle: "方案初稿", text: "别打开 PPT 就找模板，先在白板搭故事线" },
    { taskTitle: "午休黑洞", text: "午后刷视频极易超时，手机放在另一个房间" },
    { taskTitle: "数据整理", text: "深度工作前先关通知，平均少花 18 分钟" },
  ],
  insightCards: [
    {
      title: "开场焦虑是最大的时间税",
      text: "连续两天卡在「准备开始」上，耗掉 70 分钟。对策：烂初稿先行，定时器 5 分钟内必须敲下第一个字。",
    },
    {
      title: "黑洞不是罪恶，失控才是",
      text: "计划内娱乐 40 分钟恢复了状态；无倒计时的 95 分钟刷屏只带来愧疚。给快乐装上刹车。",
    },
    {
      title: "白板比 PPT 更快接近真相",
      text: "方案被否后在白板上重画叙事流，15 分钟定位卡点，而对着模板调了 2 小时排版。观点先行，样式最后。",
    },
  ],
  bedtimeReflection: "今天不是懒，是被「开场焦虑」卡住了。允许初稿烂，允许自己不完美地开始。",
  morningPlan: "10:00 前完成复盘报告框架，不碰排版、不调字体。",
  overallComment:
    "完成率 71%，紧急重要事项 3 小时 35 分是本周高点；真正的敌人不是懒，而是夜间失控与开场焦虑。今天带着两条教训开战：先动手、21 点隔离手机。",
};

/** 24 小时时间黑洞热力图（今日 Mock） */
export const TODAY_HEATMAP: HeatmapData = {
  hours: [
    { hour: 0, category: null, intensity: 0 },
    { hour: 1, category: null, intensity: 0 },
    { hour: 2, category: null, intensity: 0 },
    { hour: 3, category: null, intensity: 0 },
    { hour: 4, category: null, intensity: 0 },
    { hour: 5, category: null, intensity: 0 },
    { hour: 6, category: null, intensity: 0 },
    { hour: 7, category: "blackhole", intensity: 2 },
    { hour: 8, category: "chore", intensity: 1 },
    { hour: 9, category: "deep-work", intensity: 3 },
    { hour: 10, category: "deep-work", intensity: 3 },
    { hour: 11, category: "chore", intensity: 2 },
    { hour: 12, category: "blackhole", intensity: 2 },
    { hour: 13, category: "blackhole", intensity: 1 },
    { hour: 14, category: "deep-work", intensity: 3 },
    { hour: 15, category: "deep-work", intensity: 2 },
    { hour: 16, category: "chore", intensity: 2 },
    { hour: 17, category: "chore", intensity: 1 },
    { hour: 18, category: "blackhole", intensity: 2 },
    { hour: 19, category: "blackhole", intensity: 1 },
    { hour: 20, category: "deep-work", intensity: 2 },
    { hour: 21, category: "blackhole", intensity: 3 },
    { hour: 22, category: "blackhole", intensity: 3 },
    { hour: 23, category: null, intensity: 0 },
  ],
  stats: [
    {
      category: "deep-work",
      totalMinutes: 350,
      slices: [
        { start: "09:30", end: "11:00", label: "复盘报告撰写" },
        { start: "14:00", end: "16:20", label: "方案故事线" },
        { start: "20:10", end: "20:50", label: "读书笔记" },
      ],
    },
    {
      category: "chore",
      totalMinutes: 100,
      slices: [
        { start: "11:02", end: "11:40", label: "邮件与审批" },
        { start: "16:30", end: "17:10", label: "报销与杂务" },
        { start: "08:20", end: "08:42", label: "晨间琐事" },
      ],
    },
    {
      category: "blackhole",
      totalMinutes: 210,
      slices: [
        { start: "07:30", end: "08:00", label: "早餐" },
        { start: "12:30", end: "13:00", label: "刷短视频（午休）" },
        { start: "13:00", end: "13:20", label: "午休" },
        { start: "17:15", end: "17:45", label: "游戏摸鱼" },
        { start: "18:30", end: "19:10", label: "晚餐散步" },
        { start: "21:00", end: "22:00", label: "刷短视频（失控段）" },
      ],
    },
  ],
};
