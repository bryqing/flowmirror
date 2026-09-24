"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  QUADRANT_META,
  coerceQuadrant,
  coerceTaskCategory,
  coerceTaskStatus,
  quadrantToCategory,
  type MicroReview,
  type ParsedCommand,
  type Quadrant,
  type Task,
  type TaskCategory,
} from "@/lib/types";
import { fmtDuration, uid } from "@/lib/utils";
import { isTiming, nowClock, shiftDateKey, sumSliceMinutes } from "@/lib/task-time";
import {
  getSupabase,
  isSupabaseConfigured,
  isRealtimeAvailable,
  currentUserId,
} from "@/lib/supabase";
import {
  isRemoteMode,
  supabaseTaskRepo,
  fetchTasksOrNull,
  fetchBacklogOrNull,
  todayKey,
} from "@/lib/task-repository";
import {
  loadSnapshot,
  saveSnapshot,
  loadBacklogSnapshot,
  saveBacklogSnapshot,
  loadQueue,
  enqueue,
  dequeue,
  bumpAttempt,
  hasPendingInserts,
  MAX_ATTEMPTS,
  type PendingOp,
} from "@/lib/offline-store";
import { purgeLegacySeedData, type PurgeReport } from "@/lib/legacy-purge";

/**
 * 启动即清洗历史演示数据 —— **必须发生在模块加载期，早于任何读取**。
 *
 * 放在这里而不是某个 `useEffect` 里，是因为顺序上不能有缝：
 * 组件里恢复本地快照的 effect 一旦先跑，就又会把旧缓存里的 `TODAY_TASKS`
 * 捞进 `tasks`，界面先闪一屏假任务、随后才被清掉。放在模块顶层可以确保
 * 「清洗完成」严格早于「第一次读 localStorage」，任何调用方都不需要关心这件事。
 *
 * SSR 期间 `window` 不存在，函数内部直接返回空报告，不影响服务端渲染。
 */
const PURGE_REPORT: PurgeReport = purgeLegacySeedData();

/** 本次启动是否真的清理掉了历史假数据（供挂载后提示用户） */
const PURGED_COUNT =
  PURGE_REPORT.removedTasks + PURGE_REPORT.removedAnchors + PURGE_REPORT.removedQueueOps;

export interface Toast {
  id: string;
  message: string;
  tone: "info" | "success" | "warn" | "danger";
}

interface FlowContextValue {
  /**
   * **当日看板**：当前 `selectedDate` 那天的 Q1/Q2/Q4 任务。
   *
   * ⚠️ 不含「待执行清单」（q3 / category=rest）—— 那个象限是常驻全局池，
   * 见 `backlogTasks`。两个池按 `category` 互斥，同一个任务绝不会同时出现在两处。
   */
  tasks: Task[];
  /**
   * **待执行清单全局池**（Q3）：全量 rest 任务，**不受 selectedDate 约束**。
   *
   * 无论日期栏切到哪一天，这里始终是同一份集合；增删改直接写它自己的快照，
   * 与按日快照互不干扰。
   */
  backlogTasks: Task[];
  /** 跨池查任务（日看板 + 全局池）。编辑/计时/详情等按 id 定位时一律走它 */
  findTask: (id: string) => Task | undefined;
  careMode: boolean;
  candleMode: boolean;
  reviewTaskId: string | null;
  reviewTask: Task | null;
  detailTaskId: string | null;
  detailTask: Task | null;
  toasts: Toast[];
  /** 是否已连接 Supabase 远程同步（true=多端实时；false=本地 mock） */
  synced: boolean;
  /** 当前登录用户邮箱（未登录为 null） */
  userEmail: string | null;
  signInWithEmail: (email: string) => Promise<void>;
  /** 邮箱 + 密码登录（返回是否成功） */
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  /** 邮箱 + 密码注册（返回是否成功） */
  signUpWithPassword: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** 当前选中日期 key "YYYY-MM-DD"（联动日历回查灵感/历史任务） */
  selectedDate: string;
  setSelectedDate: (key: string) => void;
  /** 今天的日期 key（客户端挂载后校准） */
  today: string;
  /** 是否正在查看今天；false = 历史回看模式（看板数据为该日历史任务） */
  isViewingToday: boolean;
  /** 一键回到今天 */
  goToday: () => void;
  /**
   * **昨日之镜的查看日期** —— 一条独立于战局 `selectedDate` 的日期坐标。
   *
   * 默认落在「昨天」，但用户可以顺着板块内的日期条回看任意历史某天。
   * 刻意不与 `selectedDate` 共用：那块模块的语义是「回顾一个已经过完的日子」，
   * 若跟着战局一起跳到上月某天，晨间锚点就变成了那天的镜像，语义会散。
   * 未来日期一律会被钳制回今天（还没过完的日子没有「复盘」可言）。
   */
  mirrorDate: string;
  /** 切换昨日之镜的查看日期（晚于今天的会被钳制为今天） */
  setMirrorDate: (key: string) => void;
  /** 昨天（`today - 1`）的日期 key；日期条上「回到昨日」的目标，也是默认视图 */
  yesterdayDate: string;
  /** 是否正在看昨天；false = 正在回看更早的某一天 */
  isViewingYesterday: boolean;
  /** 把昨日之镜切回「昨天」 */
  goYesterday: () => void;
  /** 昨日之镜**当前选中日期**的真实任务（完成率等指标由它算出，不读 mock） */
  mirrorTasks: Task[];
  /**
   * 所选日期的数据是否已装载完毕。
   * 切换日期后会自动失效，因此不会出现「拿上一天的数字冒充新一天」。
   */
  mirrorReady: boolean;
  /**
   * **昨天的真实任务**（`today - 1`，与 `mirrorDate` 解耦）。
   *
   * 晨间心锚要用它回答「昨天还剩什么没做完」—— 这是心锚唯一的"昨日事实"来源。
   * 刻意不复用 `mirrorTasks`：那块是**用户当前翻到的那一天**，回看上月某天时
   * 它已经不再是昨天，心锚会跟着跳成那天的遗留，语义就散了。
   *
   * 同样以空数组起步、不读任何预置数据。昨天确实没有记录时它就是 `[]`，
   * 心锚据此走纯正向引导空态 —— **绝不凭空捏造一个任务名**。
   */
  yesterdayTasks: Task[];
  /**
   * 标记任务的时间段（开始时刻 + 时长，分钟）。
   * 传 undefined 表示清除。**会清空该任务已记录的计时切片**（重新规划语义）。
   */
  setTaskTime: (id: string, startClock: string | undefined, durationMin: number | undefined) => void;
  /** 开始计时：写入一个未闭合的时间切片，任务转为进行中 */
  startTiming: (id: string) => void;
  /** 结束计时：闭合切片、累计实际时长，任务回到待办 */
  stopTiming: (id: string) => void;
  /** 按当前计时状态自动开始 / 结束 */
  toggleTiming: (id: string) => void;
  /**
   * 就地改任务标题（四象限卡片行内编辑）。
   * 空字符串 / 与原文相同都会被忽略，不会产生一次无意义的云端写。
   */
  renameTask: (id: string, title: string) => void;
  completeTask: (id: string) => void;
  /**
   * **撤回完成**（反悔）：把 `done` 打回 `pending`，任务重新变成可计时、可打卡的活任务。
   *
   * 只做「状态回退」，不动时间切片 / 微复盘 —— 已记录的真实耗时和已沉淀的经验
   * 是资产，撤回一次「手滑打钩」不该把它们一并抹掉。
   * 归位由 `category` 决定：`rest` 回全局待执行池，其余回当日看板（由 commitTask 路由）。
   */
  reopenTask: (id: string) => void;
  /**
   * **象限自由转移**：任意象限之间互转（q1↔q2↔q3↔q4）。
   *
   * 本质是一次**跨池搬迁**：`rest` 与非 `rest` 分属两个互斥的池，
   * `commitTask` 会按新 category 把任务写进目标池、并从原池里摘掉，
   * 所以 Q3 → Q1/Q2/Q4（移入今日战局）与 Q1/Q2/Q4 → Q3（移出到待办池）
   * 是同一套逻辑，不需要两条路径。
   */
  moveTaskQuadrant: (id: string, quadrant: Quadrant) => void;
  closeReview: () => void;
  submitReview: (id: string, review: Omit<MicroReview, "id" | "createdAt">) => void;
  executeCommand: (cmd: ParsedCommand) => void;
  /** 直接新增任务到指定象限，返回新任务 id（供「灵感转待办」等场景复用） */
  addTask: (title: string, category: TaskCategory) => Promise<string>;
  /**
   * 批量新增任务（AI 战局速记导入用）。
   * 返回实际受理的条数；`onProgress(done, total)` 用于渲染导入进度。
   */
  addTasks: (
    items: { title: string; category: TaskCategory }[],
    onProgress?: (done: number, total: number) => void
  ) => Promise<number>;
  /** 删除任务：本地即时移除并同步云端；未落库的临时任务会撤销其待补录操作 */
  deleteTask: (id: string) => void;
  unfreeze: () => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  pushToast: (message: string, tone?: Toast["tone"]) => void;
  /**
   * **手动立即同步**：把积压的本地改动推上去，再从云端拉最新数据。
   *
   * 自动通道（Realtime / 定时轮询 / 切回前台）都在用户无感知时工作，
   * 一旦其中某一环失灵，用户手上就没有任何"我现在就想要最新数据"的手段。
   * 这个入口是那个兜底手段，也是排查同步问题时最直接的自证方式。
   */
  syncNow: () => Promise<void>;
  /** 最近一次成功从云端拉取数据的时间戳（毫秒）；从未成功过为 null */
  lastSyncedAt: number | null;
  /** 是否正在同步中（供按钮禁用态使用） */
  syncing: boolean;
}

/**
 * 判断两份任务列表是否完全一致（用于轮询去抖：内容没变就不 setState，避免无谓重渲染）。
 * 只做「判定「变没变」」，不做语义 diff —— 出现假阴性（判为已变）只会多渲染一次，无副作用。
 */
function sameTaskList(a: Task[], b: Task[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

const FlowContext = createContext<FlowContextValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  /**
   * 当日看板任务。
   *
   * ⚠️ **初值必须是空数组，绝不能再是 TODAY_TASKS 之类的内置演示数据。**
   *
   * 以前这里放演示数据，是为了"SSR 与客户端首帧一致"。但代价是：**任何一个还没
   * 被真实数据填充的瞬间，界面都在展示一整天不存在的假任务** —— 全新的日期、
   * 刚登录还没拉完、拉取失败、未登录……用户看到的都是同一批陌生任务，
   * 完全无法分辨"这是同步坏了"还是"我今天真有这些事"。
   *
   * 空数组既是水合安全的（纯静态值，SSR/客户端完全一致），又是唯一诚实的初值：
   * 没有数据就诚实地空着。本地快照 / 云端数据在挂载后的 effect 里接管。
   */
  const [tasks, setTasks] = useState<Task[]>([]);
  /**
   * 「待执行清单」全局池（Q3）。
   *
   * 同样以空数组起步（详见上方 `tasks` 的说明）；本地快照 / 云端全量集合
   * 在挂载后接管。它与 `tasks` 是**并列的两个池**：`tasks` 按 selectedDate 切片，
   * 这里永远全量。
   */
  const [backlogTasks, setBacklogTasks] = useState<Task[]>([]);
  const [careMode, setCareMode] = useState(false);
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [synced, setSynced] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(() => todayKey());
  /** 挂载后校准的「今天」。初值与 selectedDate 同源，SSR 与首帧一致，不产生水合差异 */
  const [today, setToday] = useState<string>(() => todayKey());
  /**
   * **昨日之镜的查看日期** —— 独立于 `selectedDate` 的一条日期坐标。
   *
   * 默认是「昨天」，用户可以顺着板块内的日期条回看任意历史某天。之所以不共用
   * `selectedDate`：那块模块的语义是「回顾一个已经过完的日子」，跟着战局跳到
   * 上月某天会让它变成那天的镜像，晨间锚点的含义就散了。
   */
  /**
   * **用户手动选过的昨日之镜日期**（`null` = 还没动过）。
   *
   * 存「有没有被选过」而不是「初始值写死成昨天」：挂载时若刚好跨过零点，
   * 下面的 `today` 会被校准到新的一天，默认视图也就该跟着落到新的「昨天」。
   */
  const [mirrorDatePicked, setMirrorDatePicked] = useState<string | null>(null);
  /** 昨天（`today - 1`）—— 日期条的默认视图，也是「回到昨日」的目标 */
  const yesterdayDate = useMemo(() => shiftDateKey(today, -1), [today]);
  /** 昨日之镜当前选中日期的真实任务（初始为空，装载完才填） */
  const [mirrorTasks, setMirrorTasks] = useState<Task[]>([]);
  /**
   * **已装载完毕的日期** —— 刻意存「哪一天」而不是布尔量。
   *
   * 切换日期后 `mirrorReady`（= `mirrorLoadedDate === mirrorDate`）会自动变回
   * false，不必在 effect 里再补一次「先置 false 再请求」的 setState；
   * 那种写法既会多一次渲染，又容易在 effect 顺序变化时留下短暂的状态错位。
   */
  const [mirrorLoadedDate, setMirrorLoadedDate] = useState<string | null>(null);
  /** 昨天的真实任务（晨间心锚的"昨日事实"来源，与 mirrorDate 解耦） */
  const [yesterdayTasks, setYesterdayTasks] = useState<Task[]>([]);

  /**
   * 看板当前**真实代表**的日期 —— 也就是 `tasks` 数组实际归属的那一天。
   *
   * 与 `selectedDate` 的区别很关键：切换日期后，`tasks` 要等到快照/远程数据
   * 落地才会换成新日期的内容。若写入时直接用 `selectedDate`，在切换的瞬间做一次
   * 编辑就会把「旧日期的任务列表」存到「新日期」名下（快照与云端日期双错位）。
   * 因此所有写入都以这个 ref 为准，它只在真正为某日装载完任务时才推进。
   */
  const tasksDateRef = useRef<string>(todayKey());
  /** 供轮询等长生命周期回调读取最新查看日期，避免闭包读到过期值 */
  const selectedDateRef = useRef<string>(selectedDate);
  /** 已登录用户 id（供「切换日期时拉取该日云端任务」使用） */
  const userIdRef = useRef<string | null>(null);
  /** 今天的日期 key，供长生命周期回调使用 */
  const todayRef = useRef<string>(today);

  /**
   * 某日看板的本地兜底：**只读本地快照，读不到就是空数组**。
   *
   * ⚠️ 这里以前是 `snap ?? (dateKey === today ? TODAY_TASKS : [])`，
   * 那个 `?? TODAY_TASKS` 正是"新日期默认塞入假数据"的元凶：
   * 任何一天只要**还没有本地快照**（全新日期、跨零点后的新一天、
   * 刚清过缓存、换了一台设备），今天就会被灌入一整套演示任务。
   * 日期只是数据的一个坐标，不是"该发一批示例数据"的信号 —— 一律留空。
   *
   * 另外只返回**日池**任务（Q1/Q2/Q4）：「待执行清单」不在按日快照的语义里，
   * 若让它混进来，切到任意一天都会看到同一批 Q3 条目被当成「那天的任务」
   * 参与完成率、热力大盘等按日统计 —— 池子必须是另一个维度。
   */
  const localTasksFor = useCallback((dateKey: string): Task[] => {
    const snap = loadSnapshot(dateKey);
    return (snap ?? []).filter(isDayPoolTask);
  }, []);

  /**
   * 「待执行清单」全局池的本地兜底，按优先级：
   *   1) 池子自己的快照（**空数组也是有效值**，代表「用户把池子清空了」）；
   *   2) **迁移**：旧版本的 Q3 存在「今日快照」里，把它接过来，
   *      否则升级后用户会发现待执行清单凭空消失了；
   *   3) 都没有 → 空数组（同样不再回退演示数据）。
   */
  const localBacklog = useCallback((): Task[] => {
    const snap = loadBacklogSnapshot();
    if (snap) return snap;
    const day = loadSnapshot(todayRef.current);
    return (day ?? []).filter((t) => t.category === "rest");
  }, []);

  /** 跨池查任务：日看板 + 全局池。按 id 定位的读路径（详情/复盘/编辑）一律用它 */
  const findTask = useCallback(
    (id: string): Task | undefined =>
      tasks.find((t) => t.id === id) ?? backlogTasks.find((t) => t.id === id),
    [tasks, backlogTasks]
  );

  const isViewingToday = selectedDate === today;
  /**
   * 昨日之镜的查看日期：用户选过就用他选的，没选过就跟随「昨天」。
   * 后面这种写法让默认视图天然跟随跨零点被校准的 `today`。
   */
  const mirrorDate = mirrorDatePicked ?? yesterdayDate;
  /** 昨日之镜是否停在默认视图（昨天） */
  const isViewingYesterday = mirrorDate === yesterdayDate;
  /**
   * 昨日之镜的数据是否已就位。
   *
   * 由「装载的是哪一天」推导而来，所以切到新的日期后会立刻变回 false，
   * 界面回到「统计中…」，绝不会把上一天的完成率当成新一天的结果显示。
   */
  const mirrorReady = mirrorLoadedDate === mirrorDate;

  const goToday = useCallback(() => setSelectedDate(today), [today]);

  /**
   * 切换昨日之镜的查看日期。
   *
   * 晚于今天的日期一律钳制回今天：未来还没过完，没有「复盘切片」可取。
   * 同值切换直接复用旧引用，避免点同一颗胶囊触发一次无意义的重渲染。
   */
  const setMirrorDate = useCallback(
    (key: string) => {
      const next = key > today ? today : key;
      setMirrorDatePicked((prev) => (prev === next ? prev : next));
    },
    [today]
  );

  const goYesterday = useCallback(() => setMirrorDate(yesterdayDate), [setMirrorDate, yesterdayDate]);

  // 远程写入开关：避免在 Realtime 回调里重复回写
  const suppressRemoteRef = useRef(false);

  /**
   * 供 `syncNow()` 调用的「立即同步」实现。
   *
   * 真正的实现需要 `flushQueue` / `pollOnce` 这些定义在下面那个大 effect 里的闭包，
   * 用 ref 把最新的实现挂出来，外部就能在不重建订阅的前提下随时触发一次同步。
   */
  const syncNowRef = useRef<(() => Promise<void>) | null>(null);

  const candleMode = useMemo(() => {
    const h = new Date().getHours();
    return h >= 23 || h < 1;
  }, []);

  const pushToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = uid("toast");
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4600);
  }, []);

  /**
   * 告知本次启动清理掉了历史演示数据。
   *
   * 有必要说一声：用户会看到几条"自己没建过的任务"突然消失，
   * 不解释的话第一反应是"数据丢了"，而不是"早就该删的假数据终于没了"。
   * 只在真的清理过时提示一次（版本戳保证一台设备只发生一次）。
   *
   * 刻意延到挂载之后的一拍再弹：清洗发生在模块加载期，比 React 挂载还早，
   * 立刻 `pushToast` 会在首帧渲染过程中同步 setState；推迟一拍既避开这一点，
   * 也让这条提示出现在界面已经稳定之后，更容易被看见。
   */
  useEffect(() => {
    if (PURGED_COUNT <= 0) return;
    const timer = setTimeout(() => {
      pushToast(`已清理 ${PURGED_COUNT} 条历史内置演示数据`, "info");
    }, 600);
    return () => clearTimeout(timer);
  }, [pushToast]);

  /** 新增：按分类落进对应的池，并写该池的快照 */
  const insertTask = useCallback((task: Task) => {
    if (task.category === "rest") {
      setBacklogTasks((prev) => {
        const next = [task, ...prev].sort(byCreatedAtDesc);
        saveBacklogSnapshot(next);
        return next;
      });
    } else {
      setTasks((prev) => {
        const next = [...prev, task].sort(byScheduledTime);
        saveSnapshot(next, tasksDateRef.current);
        return next;
      });
    }
  }, []);

  /**
   * 云端插入成功 → 用服务端返回的真实行替换本地临时条目。
   *
   * 先从**两个池**里按「临时 id / 真实 id」各摘一次，再按返回行的分类放回该在的池：
   * 临时行与真实行的分类理论上一致，但 AI 复核可能在中途改了象限，
   * 用返回值而不是原对象来决定归属，才不会把一条 q1 塞进待执行池里。
   *
   * ⚠️ 这一步是**多端同步的隐形前提**：只要本地还留着临时 id，
   * `commitTask` 里的 `SERVER_ID.test(id)` 门控就会一直为假 ——
   * 那条任务的后续改名/计时/打钩**永远不会被推上云端**，
   * 于是"手机改了、电脑永远看不到"。所以任何写入云端成功的路径都必须调用它。
   */
  const replaceTask = useCallback((tempId: string, saved: Task) => {
    setTasks((prev) => {
      const stripped = prev.filter((t) => t.id !== tempId && t.id !== saved.id);
      const next = (
        saved.category === "rest" ? stripped : [...stripped, saved]
      ).sort(byScheduledTime);
      saveSnapshot(next, tasksDateRef.current);
      return next;
    });
    setBacklogTasks((prev) => {
      const stripped = prev.filter((t) => t.id !== tempId && t.id !== saved.id);
      const next = (
        saved.category === "rest" ? [saved, ...stripped] : stripped
      ).sort(byCreatedAtDesc);
      saveBacklogSnapshot(next);
      return next;
    });
  }, []);

  /**
   * 统一的「改单个任务」出口：本地即时改写 + 快照落盘 + 云端同步（失败入离线队列）。
   *
   * 时间轴相关的三个写操作（标记时间段 / 开始计时 / 结束计时）、就地改名、
   * 打钩完成、微复盘沉淀都走这里。各自写一遍三件套极易漏环 —— 漏快照则刷新回滚，
   * 漏入队则断网丢改动，而这两个 bug 都只在「刷新」或「断网」时才暴露，平时完全看不出来。
   *
   * 🔑 **按分类路由到正确的池**：`rest` 落在全局池（不按日期分片），其余落在当日看板。
   * 两个池按 category 互斥，所以这里同时负责「摘掉另一个池里的同名条目」——
   * 象限变了就是一次搬家（如 AI 复核把刚记的 q3 改成 q1），
   * 不摘的话旧池会留下一个点不动的幽灵条目。
   */
  const commitTask = useCallback((updated: Task) => {
    if (updated.category === "rest") {
      setTasks((prev) => {
        if (!prev.some((t) => t.id === updated.id)) return prev;
        const next = prev.filter((t) => t.id !== updated.id);
        saveSnapshot(next, tasksDateRef.current);
        return next;
      });
      setBacklogTasks((prev) => {
        const next = (
          prev.some((t) => t.id === updated.id)
            ? prev.map((t) => (t.id === updated.id ? updated : t))
            : [updated, ...prev]
        ).sort(byCreatedAtDesc);
        saveBacklogSnapshot(next);
        return next;
      });
    } else {
      setBacklogTasks((prev) => {
        if (!prev.some((t) => t.id === updated.id)) return prev;
        const next = prev.filter((t) => t.id !== updated.id);
        saveBacklogSnapshot(next);
        return next;
      });
      setTasks((prev) => {
        /**
         * ⚠️ 必须「有则改、无则加」，**不能只 `map`**。
         *
         * `map` 只改动已存在的条目 —— 对改名 / 计时这类池内更新是对的，但对
         * **跨池搬迁**（Q3 待执行清单 → Q1/Q2/Q4）就是致命的：此时任务还在
         * 待执行池里、日池根本没有它，`map` 会静默丢弃，于是两个池都没了这条任务，
         * 详情抽屉因 `findTask` 返回 undefined 而当场关闭（实测症状：
         * 切象限后抽屉一闪而没，任务凭空消失）。
         * 与上方 rest 分支保持对称的 add-or-update 语义即可。
         */
        const next = (
          prev.some((t) => t.id === updated.id)
            ? prev.map((t) => (t.id === updated.id ? updated : t))
            : [...prev, updated]
        ).sort(byScheduledTime);
        saveSnapshot(next, tasksDateRef.current);
        return next;
      });
    }
    if (isRemoteMode() && SERVER_ID.test(updated.id)) {
      const op: PendingOp = { type: "update", task: updated, clientId: `upd-${updated.id}` };
      enqueue(op);
      supabaseTaskRepo.updateTask(updated).then((ok) => {
        if (ok) dequeue(op.clientId);
      });
    }
  }, []);

  /**
   * 把「本地有、云端一定没有」的任务补推上去。
   *
   * 判据是**临时 id**：本地乐观新增的任务 id 形如 `task-lx9f2k`，云端必定没有它；
   * 凡是 id 不是服务端 uuid 的，就是一条还没落库的真实用户数据。
   *
   * 为什么需要它：云端是权威数据源，所以"云端这一天是空的"通常会覆盖本地。
   * 但有一种情况必须例外 —— 用户**在未登录状态下记了任务**，那些任务从未离开过这台设备。
   * 若登录瞬间把云端空结果当成权威，用户刚记的东西会被清空。
   * 这时候正确做法不是保留本地就完事（那会永远推不上去），而是**补推**。
   */
  const pushLocalOnlyTasks = useCallback(
    (dateKey: string) => {
      if (!isRemoteMode()) return;
      const localOnly = (loadSnapshot(dateKey) ?? []).filter(
        (t) => isDayPoolTask(t) && !SERVER_ID.test(t.id)
      );
      localOnly.forEach((task) => {
        const op: PendingOp = { type: "insert", task, dateKey, clientId: `ins-${task.id}` };
        enqueue(op);
        void supabaseTaskRepo.insertTask(task, dateKey).then((saved) => {
          if (!saved) return;
          dequeue(op.clientId);
          suppressRemoteRef.current = true;
          replaceTask(task.id, saved);
          setTimeout(() => {
            suppressRemoteRef.current = false;
          }, 500);
        });
      });
    },
    [replaceTask]
  );

  /**
   * 采纳「某一天」的云端任务 —— **云端是唯一权威数据源**。
   *
   * 三种结果分别处理，这是整轮"多端不同步"问题的核心决策点：
   *
   *   · `remote === null`（拉取失败）→ **保持本地现状**。绝不注入假数据，
   *     也绝不把本地清空 —— 一次网络抖动不该被解读成"用户今天没有任务"。
   *   · 云端这一天为空 → 先看本地是否有**从未落库**的条目：
   *        - 有 → 补推它们并保留本地（用户在未登录时记下的真实任务，不能清）；
   *        - 没有但有排队中的新增 → 保留本地（刚记的还没推上去）；
   *        - 都没有 → 采纳空数组。**"这一天确实没有任务"是有效结论**，
   *          必须如实呈现，否则"在手机上把某天清空了"永远同步不过来。
   *   · 云端有数据 → 无条件覆盖本地旧快照 / 旧缓存。
   *
   * @returns 是否真的采纳了云端数据（用于决定要不要标记"已同步"）
   */
  const adoptRemoteDay = useCallback(
    (remote: Task[] | null, dateKey: string): boolean => {
      if (remote === null) return false;
      const dayTasks = remote.filter(isDayPoolTask);
      if (dayTasks.length === 0) {
        // 已经排队的补推先等它自己走完：`pushLocalOnlyTasks` 的第一步就是入队，
        // 所以队列里还有 insert 时再调一次只会重复入队 + 重复发请求
        // （轮询是 10s 一轮，会把一次失败放大成持续的请求风暴）。
        if (hasPendingInserts()) return false;
        const localStale = (loadSnapshot(dateKey) ?? []).filter(
          (t) => isDayPoolTask(t) && !SERVER_ID.test(t.id)
        );
        if (localStale.length > 0) {
          pushLocalOnlyTasks(dateKey);
          return false;
        }
      }
      tasksDateRef.current = dateKey;
      setTasks((prev) => {
        if (sameTaskList(prev, dayTasks)) return prev;
        saveSnapshot(dayTasks, dateKey);
        return dayTasks;
      });
      return true;
    },
    [pushLocalOnlyTasks]
  );

  /**
   * 采纳云端的「待执行清单」全局池。
   *
   * 与日看板刻意采用**不同**的空值策略（池子是全局的，没有"哪一天"的概念）：
   *   · 非空 → 无条件采纳（云端是权威）。
   *   · 空   → 仅当本地没有"还没推上去的东西"时才采纳。
   *
   * 用「离线队列 / 本地临时 id」做判据，两种意图都能满足：
   * 刚在断网时记下的条目不会被一次空响应抹掉，而真正清空则如实生效。
   */
  const adoptBacklog = useCallback(
    (remote: Task[]) => {
      if (remote.length === 0) {
        const localOnly = (loadBacklogSnapshot() ?? loadSnapshot(todayRef.current) ?? []).filter(
          (t) => t.category === "rest" && !SERVER_ID.test(t.id)
        );
        if (localOnly.length > 0 || hasPendingInserts()) return;
      }
      setBacklogTasks((prev) => {
        if (sameTaskList(prev, remote)) return prev;
        saveBacklogSnapshot(remote);
        return remote;
      });
    },
    []
  );

  // ---- 按「查看日期」装载任务：本地快照优先，随后由下方远程数据覆盖 ----
  // 看板与灵感流共用 selectedDate，所以切换日期时这里必须跟着换数据源。
  //
  // ⚠️ 非今日且本地无快照时渲染**空列表**，绝不回退 TODAY_TASKS ——
  //    演示数据是「今天」的样例，拿它去填历史日期会凭空伪造出一整天的假记录。
  useEffect(() => {
    if (typeof window === "undefined") return;
    selectedDateRef.current = selectedDate;
    // tasks 从这一刻起代表 selectedDate，之后的写入都按它归属日期
    tasksDateRef.current = selectedDate;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(localTasksFor(selectedDate));
  }, [selectedDate, today, localTasksFor]);

  // 挂载后校准「今天」：跨零点打开页面时，初值可能与真实日期差一天
  useEffect(() => {
    const t = todayKey();
    todayRef.current = t;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(t);
  }, []);

  // ---- 装载「待执行清单」全局池：只跑一次（池子自己的快照 / 从旧版今日快照迁移）----
  //
  // 刻意**不依赖 selectedDate**：换日期不该让这个池重新装载，
  // 那正是「原来切一天池子就空掉」的成因。云端数据由会话建立时拉取（见下方 effect）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBacklogTasks(localBacklog());
  }, [localBacklog]);

  // ---- 装载「昨日之镜」所选日期的任务（完成率 / 黑洞 / 教训的真实数据源）----
  //
  // 与「当前查看日期」的装载刻意分开：昨日之镜有自己的日期坐标 `mirrorDate`，
  // 默认是昨天，用户回看更早的某天也只影响它自己。
  //
  // ⚠️ 只在**已登录**时才向云端确认。未登录时 Supabase 因 RLS 返回的是
  //    空数组而非错误，若照单全收会把用户离线记录的昨日任务抹掉。
  //    登录之后云端就是权威：包括"那天确实没有记录"这个结论
  //    （如实显示空态，而不是继续拿本地旧快照冒充）。
  //
  // ⚠️ 本地快照**读不到就写空数组**，绝不保留上一天的数据 —— 否则切到一个
  //    空白日期时会短暂把前一天的完成率显示成"那天的"，这正是零 Mock 要杜绝的。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    void (async () => {
      const local = localTasksFor(mirrorDate);
      if (!cancelled) setMirrorTasks(local);

      if (isSupabaseConfigured() && synced) {
        const remote = await fetchTasksOrNull(mirrorDate);
        if (!cancelled && remote !== null) {
          const dayPool = remote.filter(isDayPoolTask);
          // 云端为空但本地还有「从未落库」的条目 → 保留本地：
          // 用户在未登录时记下的真实任务不该被一次空响应抹掉。
          const localOnly = local.filter((t) => !SERVER_ID.test(t.id));
          if (!(dayPool.length === 0 && localOnly.length > 0)) {
            setMirrorTasks(dayPool);
            saveSnapshot(dayPool, mirrorDate);
          }
        }
      }

      if (!cancelled) setMirrorLoadedDate(mirrorDate);
    })();
    return () => {
      cancelled = true;
    };
  }, [mirrorDate, synced, localTasksFor]);

  // ---- 装载「昨天」的真实任务（晨间心锚唯一的昨日事实来源）----
  //
  // 与 `mirrorDate` 刻意解耦：心锚问的永远是「昨天剩了什么」，不该随用户
  // 回看历史某天而变成那天的遗留。读不到就是空数组 —— 心锚据此走纯正向引导
  // 空态，而不是替用户编一个任务名出来。
  //
  // ⚠️ 与镜像装载同一套「未登录不当权威」的判据：Supabase 在 RLS 下对未登录
  //    返回空数组而非错误，照单全收会抹掉用户离线记下的真实任务。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    void (async () => {
      const local = localTasksFor(yesterdayDate);
      if (!cancelled) setYesterdayTasks(local);

      if (isSupabaseConfigured() && synced) {
        const remote = await fetchTasksOrNull(yesterdayDate);
        if (!cancelled && remote !== null) {
          const dayPool = remote.filter(isDayPoolTask);
          // 云端为空 + 本地还有从未落库的条目 → 保留本地（同镜像装载的判据）
          const localOnly = local.filter((t) => !SERVER_ID.test(t.id));
          if (!(dayPool.length === 0 && localOnly.length > 0)) {
            setYesterdayTasks(dayPool);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [yesterdayDate, synced, localTasksFor]);

  // ---- 切换查看日期时拉取该日云端任务（已登录才发）----
  // 本地快照已在上面的 effect 里同步渲染过，这里做的是「以云端为准纠正它」，
  // 所以不阻塞首屏、也不会闪一下空列表。
  //
  // ⚠️ 只依赖 `synced`：登录/登出会翻转它，正好覆盖"登录后才该开始拉云端"这件事。
  useEffect(() => {
    if (typeof window === "undefined" || !isSupabaseConfigured()) return;
    if (!synced || !userIdRef.current) return;
    let cancelled = false;
    void (async () => {
      const remote = await fetchTasksOrNull(selectedDate);
      if (cancelled) return;
      if (adoptRemoteDay(remote, selectedDate)) setLastSyncedAt(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, synced, adoptRemoteDay]);

  // ---- Supabase 初始化：登录态检测 + 拉取远程任务 + Realtime 订阅 + 离线回退 ----
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let channel: ReturnType<ReturnType<typeof getSupabase>["channel"]> | null = null;
    let cancelled = false;
    const supabase = getSupabase();

    /**
     * 把一条 Realtime 变更落到**正确的池**里。
     *
     * 判断顺序是关键：**先看它是不是待执行清单**。那个池是全局的、不受
     * 「当前查看哪一天」约束，必须无条件吸收 —— 否则手机上把 Q3 打了钩，
     * 平板上还挂着旧状态（甚至因为日期对不上而永远收不到）。
     * 其余分类才回到「只吸收当前查看日期」的老规矩。
     */
    const applyRemoteRow = (
      eventType: "INSERT" | "UPDATE" | "DELETE",
      row: Record<string, unknown>,
      old: Record<string, unknown> | null
    ) => {
      // payload.old 默认只带主键（表未开 REPLICA IDENTITY FULL），所以删除时
      // 无法得知它原本属于哪个池 —— 两个池都按 id 清一次：id 全局唯一，幂等且不误伤。
      if (eventType === "DELETE") {
        const id = String(row.id ?? old?.id ?? "");
        if (!id) return;
        setTasks((prev) => {
          const next = prev.filter((t) => t.id !== id);
          saveSnapshot(next, selectedDateRef.current);
          return next;
        });
        setBacklogTasks((prev) => {
          const next = prev.filter((t) => t.id !== id);
          saveBacklogSnapshot(next);
          return next;
        });
        return;
      }

      const updated = rowToTaskLocal(row);

      // —— 落进全局池 ——
      if (updated.category === "rest") {
        setBacklogTasks((prev) => {
          const next = prev.some((t) => t.id === updated.id)
            ? prev.map((t) => (t.id === updated.id ? updated : t))
            : [updated, ...prev];
          next.sort(byCreatedAtDesc);
          saveBacklogSnapshot(next);
          return next;
        });
        // 它可能刚从日池挪进来（AI 复核改了象限），顺手摘掉日池里那份
        setTasks((prev) => {
          if (!prev.some((t) => t.id === updated.id)) return prev;
          const next = prev.filter((t) => t.id !== updated.id);
          saveSnapshot(next, selectedDateRef.current);
          return next;
        });
        return;
      }

      // —— 非 rest ——
      // 若它原本在池里（象限变更后离开），也要把池子那份清掉，避免留下幽灵条目
      setBacklogTasks((prev) => {
        if (!prev.some((t) => t.id === updated.id)) return prev;
        const next = prev.filter((t) => t.id !== updated.id);
        saveBacklogSnapshot(next);
        return next;
      });

      const rowDate =
        typeof row.date === "string" ? row.date : (old?.date as string | undefined);
      if (rowDate && rowDate !== selectedDateRef.current) return;
      setTasks((prev) => {
        const next = prev.some((t) => t.id === updated.id)
          ? prev.map((t) => (t.id === updated.id ? updated : t)).sort(byScheduledTime)
          : [...prev, updated].sort(byScheduledTime);
        saveSnapshot(next, selectedDateRef.current);
        return next;
      });
    };

    /** 订阅 tasks 表 Realtime（多端实时同步），重复调用前先断开旧订阅 */
    const subscribeTasks = (userId: string) => {
      // 代理模式（浏览器 + 生产）下 Realtime 不可用：WebSocket 无法穿过 HTTP 反向代理。
      // 直接跳过，避免底层以 wss://<origin>/api/supabase/... 无限重连刷错误日志；
      // 多端同步由下方 startPolling() 的轮询接管。
      if (!isRealtimeAvailable()) return;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      channel = supabase
        .channel("tasks-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` },
          (payload) => {
            if (suppressRemoteRef.current) return;
            applyRemoteRow(
              payload.eventType as "INSERT" | "UPDATE" | "DELETE",
              payload.new as Record<string, unknown>,
              (payload.old as Record<string, unknown> | null) ?? null
            );
          }
        )
        .subscribe();
    };

    // ---- 轮询回补：Realtime 的兜底通道 ----
    //
    // 两条通道并存，理由很实在：
    //   · Realtime 可用（直连模式）→ WebSocket 推送是即时的，但**长连接会静默死掉**
    //     （网络切换、休眠唤醒、中间设备超时回收），而它不一定会触发错误回调。
    //     所以仍保留一个低频（60s）的兜底轮询：万一 WS 已经哑了，最多一分钟也能自愈。
    //   · Realtime 不可用（同源代理模式，WS 穿不过 HTTP 反向代理）→ 轮询就是主通道，
    //     间隔取 10s：用户"在手机上改完、抬头看电脑"，这个量级才等得起。
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollInFlight = false;

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    /**
     * 补录离线队列（逐条补推，失败累计次数、超过上限即放弃）。
     *
     * ⚠️ 失败上限是**必须**的：没有它时，一条永远不可能成功的操作
     * （更新一条已被别端删掉的行、触发约束报错……）会永久留在队列里，
     * 而"队列非空就暂停拉取"的判据会让**多端同步永久停摆** ——
     * 用户看到的是"手机上明明改了，电脑端再也不动了"。宁可有界地放弃并告知，
     * 也不要无声地卡死整条同步链。
     */
    const flushQueue = async () => {
      const pending = loadQueue();
      if (pending.length === 0) return;
      const userId = await currentUserId();
      if (!userId) return; // 未登录不补录（等下次登录）

      for (const op of pending) {
        if (cancelled) return;
        let ok = false;
        let errText = "";
        try {
          if (op.type === "insert") {
            const saved = await supabaseTaskRepo.insertTask(op.task, op.dateKey);
            ok = saved !== null;
            if (ok && saved) {
              // 关键：换上服务端真实 id —— 否则这条任务的后续改动永远推不上去
              suppressRemoteRef.current = true;
              replaceTask(op.task.id, saved);
              setTimeout(() => {
                suppressRemoteRef.current = false;
              }, 500);
            }
          } else if (op.type === "update") {
            ok = await supabaseTaskRepo.updateTask(op.task);
          } else if (op.type === "delete") {
            ok = await supabaseTaskRepo.deleteTask(op.id);
          }
        } catch (err) {
          errText = err instanceof Error ? err.message : String(err);
        }
        if (ok) {
          dequeue(op.clientId);
          continue;
        }
        const attempts = bumpAttempt(op.clientId, errText || "云端写入未成功");
        if (attempts >= MAX_ATTEMPTS) {
          dequeue(op.clientId);
          const label =
            op.type === "delete" ? "一条删除" : op.task.title;
          console.warn("[FlowMirror] 离线操作连续失败，已放弃并继续同步：", op);
          pushToast(`「${label}」连续 ${attempts} 次未能同步到云端，已跳过`, "warn");
        }
      }
    };

    /**
     * 拉一次云端（日看板 + 待执行清单池），并把"该不该采纳"交给统一的采纳函数。
     *
     * @param reason 触发来源。定时轮询在后台标签页里直接跳过（省电省流量）；
     *               其余来源（回到前台 / 窗口获得焦点 / 手动同步）无条件执行 ——
     *               这些正是"用户回来了，现在就要最新数据"的时刻。
     */
    const pollOnce = async (reason: "timer" | "active" | "manual" = "timer") => {
      if (reason === "timer" && typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (pollInFlight) return;
      pollInFlight = true;
      if (reason === "manual") setSyncing(true);
      try {
        // 先把积压的本地改动推上去。这一步顺带解开了老实现的自锁：
        // 以前"队列非空 → 整轮跳过"，于是队列一卡就再也不拉取；
        // 现在补录失败有上限，超限即放弃，绝不会永久挡住后面的拉取。
        if (loadQueue().length > 0) await flushQueue();

        const dateKey = selectedDateRef.current;
        // 两个池并行拉：日看板带 date 过滤，待执行池不带（全量集合）
        const [remote, backlogRemote] = await Promise.all([
          fetchTasksOrNull(dateKey),
          fetchBacklogOrNull(),
        ]);
        if (cancelled) return;
        if (remote !== null) setLastSyncedAt(Date.now());
        adoptRemoteDay(remote, dateKey);
        if (backlogRemote) adoptBacklog(backlogRemote);
      } catch (err) {
        console.warn("[FlowMirror] 同步拉取失败（保持本地状态）：", err);
      } finally {
        pollInFlight = false;
        if (reason === "manual") setSyncing(false);
      }
    };

    const startPolling = () => {
      stopPolling();
      pollTimer = setInterval(
        () => void pollOnce("timer"),
        isRealtimeAvailable() ? 60_000 : 10_000
      );
    };

    /**
     * 用户"回来了"——把三条浏览器信号都当成同步触发点。
     *
     * 三者的覆盖面并不重合，只监听其中一个会漏：
     *   · `visibilitychange` → 标签页从后台切回前台；
     *   · `focus`            → 在同一标签页内、或从别的**窗口**切回来
     *                          （例如从手机上抬头点一下电脑上的另一扇窗）；
     *   · `pageshow`         → 从 bfcache 前进/后退恢复页面（这种恢复不触发前两者）。
     * 任一端在别处改了数据，用户切回来的第一眼就该看到最新的。
     */
    const pullOnActive = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void pollOnce("active");
    };

    /** 建立已登录会话：拉取云端任务 → 切换已同步 → 订阅 Realtime / 启动轮询 */
    const attachRemoteSession = async (userId: string, email: string | null) => {
      userIdRef.current = userId;
      setUserEmail(email);
      // 拉取「当前正在查看的那天」，而不是死板地拉今天
      const dateKey = selectedDateRef.current;
      // 两个池并行拉：日看板按日过滤，待执行清单是全量集合
      const [remote, backlogRemote] = await Promise.all([
        fetchTasksOrNull(dateKey),
        fetchBacklogOrNull(),
      ]);
      if (cancelled) return;
      // 云端是权威：**包括"这一天是空的"**。老实现在云端为空时保留本地，
      // 于是"在手机上把某天清空了"永远同步不过来；现在改由 adoptRemoteDay
      // 用"本地是否还有从未落库的条目"来区分「云端确实没有」与「本地还没推上去」。
      if (adoptRemoteDay(remote, dateKey)) setLastSyncedAt(Date.now());
      if (backlogRemote) adoptBacklog(backlogRemote);
      setSynced(true);
      subscribeTasks(userId);
      startPolling();
    };

    /**
     * 清除已登录会话：回退到本地数据。
     *
     * 注意这不是"回退到演示数据"——本地快照本身就是用户真实录入的内容，
     * 登出只是断开云端通道，不该让屏幕上多出任何陌生的任务。
     */
    const detachRemoteSession = () => {
      userIdRef.current = null;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      stopPolling();
      setUserEmail(null);
      setSynced(false);
      setLastSyncedAt(null);
      const dateKey = selectedDateRef.current;
      tasksDateRef.current = dateKey;
      setTasks(localTasksFor(dateKey));
      // 全局池回到它自己的本地快照（与日期无关，所以不随 dateKey 变）
      setBacklogTasks(localBacklog());
    };

    (async () => {
      const userId = await currentUserId();
      if (cancelled) return;
      if (!userId) return; // 未登录：只读本地快照，不订阅也不拉取
      let email: string | null = null;
      try {
        email = (await supabase.auth.getUser()).data.user?.email ?? null;
      } catch (err) {
        // 取邮箱失败不该阻断整条同步链：id 已经有了，云端照样能读写
        console.warn("[FlowMirror] 读取用户邮箱失败（不影响同步）：", err);
      }
      if (cancelled) return;
      await attachRemoteSession(userId, email);
    })();

    // 手动立即同步：推积压 → 拉最新。未登录时明确告知，而不是静默什么都不做。
    syncNowRef.current = async () => {
      const userId = await currentUserId();
      if (!userId) {
        pushToast("未登录，无法同步云端数据", "warn");
        return;
      }
      userIdRef.current = userId;
      await flushQueue();
      await pollOnce("manual");
      pushToast("已同步最新数据", "success");
    };

    // 监听认证状态变化（登录 / 登出 / 令牌刷新）——保证密码登录后立即拉取云端数据。
    //
    // ⚠️ 必须区分「从未登录」与「从登录态退出」：
    //    supabase-js 在 subscribe 的瞬间会补发一次 INITIAL_SESSION，未登录时其 session 为 null。
    //    若此时直接走 detachRemoteSession()，会把上面 effect 刚从本地快照恢复出来的任务
    //    无谓地再装载一遍（并可能打断正在进行中的首次拉取）。
    //    只有真正经历过登录再登出，才该走 detach。
    let hadSession = false;
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session?.user) {
        hadSession = true;
        void attachRemoteSession(session.user.id, session.user.email ?? null);
      } else if (hadSession) {
        hadSession = false;
        detachRemoteSession();
      }
    });

    /** 网络恢复：先补录离线队列，再拉一次最新 */
    const handleOnline = () => {
      void (async () => {
        await flushQueue();
        await pollOnce("active");
      })();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("focus", pullOnActive);
      window.addEventListener("pageshow", pullOnActive);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", pullOnActive);
    }

    return () => {
      cancelled = true;
      syncNowRef.current = null;
      authSub.subscription.unsubscribe();
      stopPolling();
      if (channel) {
        getSupabase().removeChannel(channel);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("focus", pullOnActive);
        window.removeEventListener("pageshow", pullOnActive);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", pullOnActive);
      }
    };
  }, [
    pushToast,
    localTasksFor,
    localBacklog,
    adoptRemoteDay,
    adoptBacklog,
    replaceTask,
  ]);

  /**
   * 手动立即同步（对外）。真正实现在上面那个 effect 的 ref 里 ——
   * 这样按钮不会因为"重新订阅 Realtime"而触发副作用。
   */
  const syncNow = useCallback(async () => {
    const fn = syncNowRef.current;
    if (!fn) {
      pushToast("云端未配置，当前为纯本地模式", "warn");
      return;
    }
    await fn();
  }, [pushToast]);

  const completeTask = useCallback(
    (id: string) => {
      const target = findTask(id);
      if (target && target.status !== "done") {
        commitTask({
          ...target,
          status: "done" as const,
          actualDuration: target.actualDuration ?? target.plannedDuration,
        });
      }
      // 无论写入与否都唤起微复盘：打钩本身就是「这件事完成了」的信号
      setReviewTaskId(id);
    },
    [findTask, commitTask]
  );

  /**
   * 撤回完成（反悔）：`done` → `pending`。
   *
   * 场景是「手滑打了钩」或「本想明天做」——打钩是单点动作，误触率天然高于其他操作，
   * 所以撤销入口必须和打钩本身一样轻（卡片上再点一次圆圈即可）。
   *
   * 刻意**不清空时间切片与微复盘**：那些是真实发生过的记录。
   * 若一并抹掉，用户为了纠正一次误触会付出丢掉已记时长/经验的代价，比不撤销更糟。
   *
   * 已经打开着的微复盘抽屉要顺手关掉 —— 它正指向一个刚被撤回的任务，
   * 留着会让「入库」按钮把一次未发生的完成记录下来。
   */
  const reopenTask = useCallback(
    (id: string) => {
      const target = findTask(id);
      if (!target || target.status !== "done") return;
      commitTask({ ...target, status: "pending" as const });
      setReviewTaskId((cur) => (cur === id ? null : cur));
      pushToast(`已撤回完成「${target.title}」，重新可计时`, "info");
    },
    [findTask, commitTask, pushToast]
  );

  /**
   * 象限自由转移 —— 四象限任意互转（含「移出到待执行池」与「移入今日战局」两个方向）。
   *
   * `commitTask` 按**新** category 路由：写进目标池的同时从原池摘掉同 id，
   * 所以"搬家"是原子的，不会两池各留一份。
   *
   * ⚠️ 还要改写离线队列里那笔尚未补录的 insert：本地临时 id 的任务通常还没落库，
   * 队列里存着它的旧 category。不改的话，断网时恢复网络一补录，象限就被打回原形
   * （表现为「我明明挪到 Q1 了，一联网又回到待执行清单」）。
   */
  const moveTaskQuadrant = useCallback(
    (id: string, quadrant: Quadrant) => {
      const target = findTask(id);
      if (!target) return;
      const category = quadrantToCategory(quadrant);
      if (target.category === category) return; // 没变，省掉一次无意义的云端写
      if (target.status === "frozen") {
        pushToast("该任务已冷冻，解冻后再调整象限", "warn");
        return;
      }
      const updated: Task = { ...target, category };
      // frozen 不是合法目标态，这里只改象限；黑洞倒计时时长按需补齐，
      // 让任务挪进 Q4 后立刻能用上刹车机制（否则抽屉里的倒计时没有默认值）
      if (category === "blackhole" && !updated.blackholeMinutes) {
        updated.blackholeMinutes = 30;
      }
      commitTask(updated);

      const queued = loadQueue().find((op) => op.type === "insert" && op.task.id === id);
      if (queued && queued.type === "insert") enqueue({ ...queued, task: updated });

      const label = QUADRANT_META[quadrant].label;
      pushToast(
        category === "rest"
          ? `已移出到【${label}】，稍后再做`
          : `已移入【${label}】· 今日战局`,
        "success"
      );
    },
    [findTask, commitTask, pushToast]
  );

  const closeReview = useCallback(() => setReviewTaskId(null), []);

  /**
   * 就地改任务标题。
   *
   * 走和 setTaskTime 同一条 commitTask 出口，不单独再写一遍三件套 ——
   * 漏快照则刷新回滚，漏入队则断网丢改动，两个 bug 都只在刷新/断网时才暴露。
   * 标题只是文案、不触碰时间切片，所以「正在计时」也不拦；但冷冻任务视为只读。
   *
   * 不加 toast：改名的反馈就是卡片上那行字当场变了，再弹一条反而吵。
   * （空串 / 未改动直接吞掉，避免用户点一下标题又点出去就产生一条云端写。）
   */
  const renameTask = useCallback(
    (id: string, title: string) => {
      const next = title.trim();
      if (!next) return;
      const target = findTask(id);
      if (!target || target.title === next) return;
      if (target.status === "frozen") return;
      commitTask({ ...target, title: next });
    },
    [findTask, commitTask]
  );

  /**
   * 标记任务的「时间段」—— 热力大盘的主力数据来源。
   *
   * 会清空该任务已记录的计时切片：这个动作的语义是「重新规划这件事占哪段时间」，
   * 而热力图**优先展示真实切片**；若保留旧切片，用户标记完会发现图形没变，
   * 只能认为是功能坏了。正在计时中的任务直接拒绝，避免把进行中的计时抹掉。
   */
  const setTaskTime = useCallback(
    (id: string, startClock: string | undefined, durationMin: number | undefined) => {
      const target = findTask(id);
      if (!target) return;
      if (isTiming(target)) {
        pushToast("该任务正在计时，先结束计时再调整时间段", "warn");
        return;
      }
      const duration = durationMin && durationMin > 0 ? durationMin : undefined;
      commitTask({
        ...target,
        scheduledTime: startClock,
        plannedDuration: duration,
        timeSlices: [],
        actualDuration: undefined,
      });
      pushToast(
        startClock
          ? `已标记时间段 ${startClock}${duration ? ` · ${fmtDuration(duration)}` : ""}`
          : "已清除该任务的时间段",
        startClock ? "success" : "info"
      );
    },
    [findTask, commitTask, pushToast]
  );

  /** 开始计时：追加一个未闭合切片，任务转为进行中 */
  const startTiming = useCallback(
    (id: string) => {
      const target = findTask(id);
      if (!target) return;
      if (target.status === "done") {
        pushToast("该任务已完成，无需计时", "warn");
        return;
      }
      if (target.status === "frozen") {
        pushToast("该任务已冷冻，解冻后再计时", "warn");
        return;
      }
      if (isTiming(target)) return; // 已在计时，忽略重复点击
      commitTask({
        ...target,
        status: "in-progress",
        // 目标任务的切片数组可能缺失（历史脏数据），先补空数组再追加
        timeSlices: [
          ...(target.timeSlices ?? []),
          { start: nowClock(), end: "", label: target.title },
        ],
      });
      pushToast(`开始计时 · ${target.title}`, "info");
    },
    [findTask, commitTask, pushToast]
  );

  /** 结束计时：闭合切片、累计实际时长，任务回到待办（还没做完，只是这段记完了） */
  const stopTiming = useCallback(
    (id: string) => {
      const target = findTask(id);
      if (!target) return;
      const slices = target.timeSlices ?? [];
      const index = slices.findIndex((s) => Boolean(s.start) && !s.end);
      if (index < 0) return;
      const closed = slices.map((s, i) =>
        i === index ? { ...s, end: nowClock() } : s
      );
      const recorded = sumSliceMinutes(closed);
      commitTask({
        ...target,
        status: target.status === "done" ? "done" : "pending",
        timeSlices: closed,
        actualDuration: recorded,
      });
      pushToast(`已记录 ${fmtDuration(recorded)} · ${target.title}`, "success");
    },
    [findTask, commitTask, pushToast]
  );

  const toggleTiming = useCallback(
    (id: string) => {
      const target = findTask(id);
      if (!target) return;
      if (isTiming(target)) stopTiming(id);
      else startTiming(id);
    },
    [findTask, startTiming, stopTiming]
  );

  const submitReview = useCallback(
    (id: string, review: Omit<MicroReview, "id" | "createdAt">) => {
      const full: MicroReview = {
        ...review,
        id: uid("mr"),
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      };
      // 走 commitTask：待执行池里的任务同样能挂微复盘（它也是个任务，只是没有归属日）
      const target = findTask(id);
      if (target) commitTask({ ...target, microReviews: [...(target.microReviews ?? []), full] });
      setReviewTaskId(null);
      pushToast("微复盘已入库，经验卡片 +1", "success");
    },
    [findTask, commitTask, pushToast]
  );

  const signInWithEmail = useCallback(async (email: string) => {
    if (!isSupabaseConfigured()) {
      pushToast("Supabase 未配置，请先检查环境变量", "warn");
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) {
      pushToast(`登录失败：${error.message}`, "danger");
    } else {
      pushToast("登录链接已发送到邮箱，请查收并点击", "success");
    }
  }, [pushToast]);

  /** 邮箱 + 密码登录：成功后 Supabase 持久化会话，onAuthStateChange 会自动拉取云端数据 */
  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      if (!isSupabaseConfigured()) {
        pushToast("Supabase 未配置，请先检查环境变量", "warn");
        return false;
      }
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) {
        pushToast(`登录失败：${translateAuthError(error.message)}`, "danger");
        return false;
      }
      pushToast("登录成功，正在同步云端数据…", "success");
      return true;
    },
    [pushToast]
  );

  /** 邮箱 + 密码注册：成功后若开启邮箱确认需验证；未开启则直接登录 */
  const signUpWithPassword = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      if (!isSupabaseConfigured()) {
        pushToast("Supabase 未配置，请先检查环境变量", "warn");
        return false;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { data, error } = await getSupabase().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (error) {
        pushToast(`注册失败：${translateAuthError(error.message)}`, "danger");
        return false;
      }
      // 未开启「邮箱确认」时 registration 直接返回 session，即已登录
      pushToast(
        data.session ? "注册成功，已自动登录并开始同步" : "注册成功，请查收邮箱完成验证后登录",
        "success"
      );
      return true;
    },
    [pushToast]
  );

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    await getSupabase().auth.signOut();
    setSynced(false);
    setLastSyncedAt(null);
    const dateKey = selectedDateRef.current;
    tasksDateRef.current = dateKey;
    setTasks(localTasksFor(dateKey));
    setBacklogTasks(localBacklog());
    pushToast("已退出登录，回到本地模式", "info");
  }, [localTasksFor, localBacklog, pushToast]);

  /**
   * AI 象限复核 —— 只在本地方案「没底气」时调用。
   *
   * 命令条追求的是**即时**录入，所以先用本地规则（`classifyQuadrant`）判定；
   * 规则由 QUADRANT_META 判据拆解而来，常见表达都能命中。只有一句话里没有任何
   * 可识别的信号（`confident: false`，兜底成了 q3）时，才追加一次 AI 复核 ——
   * 复用与「AI 速记」完全相同的端点与判据，结论一致就什么都不做，
   * 不一致才把任务挪到正确象限并**明确告知用户**（不静默改用户的东西）。
   *
   * ⚠️ 低置信度会先兜底成 q3 —— 也就是**先落进全局待执行池**。复核出 q1/q2/q4 时
   * 这条任务要「搬回」当日看板，commitTask 会负责把池里那份摘掉；
   * 同时还要改掉离线队列里那笔 insert，否则断网时补录回来仍是 q3。
   */
  const refineTaskQuadrant = useCallback(
    async (taskId: string, title: string, localQuadrant: Quadrant) => {
      const local = findTask(taskId);
      if (!local) return;
      try {
        const res = await fetch("/api/ai/parse-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: title }),
        });
        if (!res.ok) return; // AI 未配置 / 超时 / 解析失败：保留本地判定
        const data = (await res.json()) as { tasks?: { quadrant?: unknown }[] };
        const refined = coerceQuadrant(data.tasks?.[0]?.quadrant);
        if (!refined || refined === localQuadrant) return;

        const updatedTask: Task = { ...local, category: quadrantToCategory(refined) };
        commitTask(updatedTask);
        // 本地临时 id 还没落库：改写离线队列里那笔插入，补录时才带得上新象限
        const queued = loadQueue().find((op) => op.type === "insert" && op.task.id === taskId);
        if (queued && queued.type === "insert") enqueue({ ...queued, task: updatedTask });
        pushToast(`AI 复核后归入【${QUADRANT_META[refined].label}】`, "info");
      } catch (err) {
        console.warn("[FlowMirror] AI 象限复核失败（保留本地判定）：", err);
      }
    },
    [pushToast, findTask, commitTask]
  );

  const executeCommand = useCallback(
    (cmd: ParsedCommand) => {
      switch (cmd.intent) {
        case "add": {
          // 象限由 lib/nlp.ts 的本地判定给出（不再一律塞进 q1）；
          // 内部持久化键通过 QUADRANT_TO_CATEGORY 换算，不在这里硬编码
          const task: Task = {
            id: uid("task"),
            title: cmd.title,
            status: "pending",
            category: quadrantToCategory(cmd.quadrant),
            scheduledTime: cmd.time,
            plannedDuration: 50,
            timeSlices: [],
            microReviews: [],
            insights: [],
            sops: ["先拆出第一步最小动作", "定时器 25 分钟，先跑一个番茄钟", "完成比完美重要"],
            pitfalls: [],
            // 落库前先给个本地时间戳：待执行池的卡片要立刻显示「什么时候记的」
            createdAt: new Date().toISOString(),
          };
          // 待执行清单进全局常驻池，其余进当日看板（insertTask 内部按分类路由）。
          // date 列仍写当前查看日：池子不靠它过滤，只作为「录入于哪一天」的存档。
          const dateKey = tasksDateRef.current;
          insertTask(task);
          if (isRemoteMode()) {
            const op: PendingOp = { type: "insert", task, dateKey, clientId: `ins-${task.id}` };
            enqueue(op);
            supabaseTaskRepo.insertTask(task, dateKey).then((saved) => {
              if (saved) {
                dequeue(op.clientId);
                // 用服务端返回的真实 id / created_at 替换本地临时条目
                suppressRemoteRef.current = true;
                replaceTask(task.id, saved);
                setTimeout(() => { suppressRemoteRef.current = false; }, 500);
              }
            });
          }
          pushToast(cmd.summary, "success");
          // 没命中任何明确信号时，让 AI 再复核一次象限（命中则无需多此一举）
          if (!cmd.confident) void refineTaskQuadrant(task.id, task.title, cmd.quadrant);
          break;
        }
        case "reschedule": {
          // 两个池都找：包括存在全局待执行池里的条目
          const target =
            tasks.find((t) => t.title.includes(cmd.keyword) && t.status !== "done") ??
            backlogTasks.find((t) => t.title.includes(cmd.keyword) && t.status !== "done");
          if (target) {
            commitTask({
              ...target,
              scheduledTime: cmd.time ?? target.scheduledTime,
              status: "pending" as const,
            });
            pushToast(cmd.summary, "success");
          } else {
            pushToast(`没有找到包含「${cmd.keyword}」的任务，换个关键词试试`, "warn");
          }
          break;
        }
        case "blackhole": {
          const task: Task = {
            id: uid("bh"),
            title: cmd.title,
            status: "in-progress",
            category: "blackhole",
            scheduledTime: nowClock(),
            blackholeMinutes: cmd.minutes,
            plannedDuration: cmd.minutes,
            timeSlices: [{ start: nowClock(), end: "", label: cmd.title }],
            microReviews: [],
            insights: [],
            sops: [],
            pitfalls: [],
            createdAt: new Date().toISOString(),
          };
          insertTask(task);
          if (isRemoteMode()) {
            const bhDateKey = tasksDateRef.current;
            const op: PendingOp = { type: "insert", task, dateKey: bhDateKey, clientId: `ins-${task.id}` };
            enqueue(op);
            supabaseTaskRepo.insertTask(task, bhDateKey).then((saved) => {
              if (saved) {
                dequeue(op.clientId);
                suppressRemoteRef.current = true;
                replaceTask(task.id, saved);
                setTimeout(() => { suppressRemoteRef.current = false; }, 500);
              }
            });
          }
          pushToast(cmd.summary, "danger");
          // 自动打开详情抽屉，黑洞倒计时即刻启动
          setDetailTaskId(task.id);
          break;
        }
        case "fuse": {
          // 熔断只作用于**当日看板**：待执行清单是常驻的「以后再说」，
          // 把它一起冻掉等于永久封住整个池子，那不是熔断的本意。
          setCareMode(true);
          setTasks((prev) => {
            const next = prev.map((t) => (t.status === "pending" ? { ...t, status: "frozen" as const } : t));
            saveSnapshot(next, tasksDateRef.current);
            if (isRemoteMode()) {
              next.filter((t) => t.status === "frozen").forEach((t) => {
                const op: PendingOp = { type: "update", task: t, clientId: `upd-${t.id}` };
                enqueue(op);
                supabaseTaskRepo.updateTask(t).then((ok) => {
                  if (ok) dequeue(op.clientId);
                });
              });
            }
            return next;
          });
          pushToast(cmd.summary, "warn");
          break;
        }
        default:
          pushToast(cmd.summary, "info");
      }
    },
    [pushToast, tasks, backlogTasks, refineTaskQuadrant, insertTask, replaceTask, commitTask]
  );

  // 直接新增任务到指定象限（灵感转待办、快速入格等场景复用），返回新任务 id
  const addTask = useCallback(
    async (title: string, category: TaskCategory): Promise<string> => {
      const task: Task = {
        id: uid("task"),
        title,
        status: "pending",
        category,
        plannedDuration: 50,
        timeSlices: [],
        microReviews: [],
        insights: [],
        sops: ["先拆出第一步最小动作", "定时器 25 分钟，先跑一个番茄钟", "完成比完美重要"],
        pitfalls: [],
        createdAt: new Date().toISOString(),
      };
      // rest → 全局待执行池，其余 → 当日看板
      insertTask(task);
      if (isRemoteMode()) {
        const dateKey = tasksDateRef.current;
        const op: PendingOp = { type: "insert", task, dateKey, clientId: `ins-${task.id}` };
        enqueue(op);
        try {
          const saved = await supabaseTaskRepo.insertTask(task, dateKey);
          if (saved) {
            dequeue(op.clientId);
            suppressRemoteRef.current = true;
            replaceTask(task.id, saved);
            setTimeout(() => { suppressRemoteRef.current = false; }, 500);
            return saved.id;
          }
        } catch (err) {
          // 网络异常不能让调用方炸掉：任务已乐观落界面 + 入队，
          // 网络恢复后会由 flushQueue 自动补录（与 addTasks 的逐条 try/catch 一致）。
          console.warn("[FlowMirror] 新增任务云端写入异常（保留离线队列待补录）：", err);
        }
      }
      return task.id;
    },
    [insertTask, replaceTask]
  );

  /**
   * 批量新增任务（AI 战局速记「确认导入」）。
   *
   * 与单条 addTask 同一套降级策略，但云端写入**串行**而非批量 insert：
   * batch insert 的返回行顺序没有可靠保证，一旦与请求顺序错位，
   * 本地任务就会持有别人的服务端 id —— 之后任何更新/删除都会打错行。
   * 串行慢一点，但每一条都能拿到确定的 id。
   *
   * AI 拆解会把条目分到不同象限，其中可能包含 q3 → **按分类拆进两个池**：
   * 若整批都塞进当日看板，待执行池就永远收不到这批条目（且会在下次轮询时消失）。
   */
  const addTasks = useCallback(
    async (
      items: { title: string; category: TaskCategory }[],
      onProgress?: (done: number, total: number) => void
    ): Promise<number> => {
      const list = items.filter((it) => it.title.trim().length > 0);
      if (list.length === 0) return 0;

      const createdAt = new Date().toISOString();
      const created: Task[] = list.map((it) => ({
        id: uid("task"),
        title: it.title.trim(),
        status: "pending",
        category: it.category,
        plannedDuration: 50,
        timeSlices: [],
        microReviews: [],
        insights: [],
        sops: ["先拆出第一步最小动作", "定时器 25 分钟，先跑一个番茄钟", "完成比完美重要"],
        pitfalls: [],
        createdAt,
      }));

      // 1) 先乐观落界面 + 本地快照 —— 点了就必须有反应，云端失败也不留空白。
      //    按分类分组后一次性写入各自的池（避免逐条 setState）。
      const newPool = created.filter((t) => t.category === "rest");
      const newDay = created.filter((t) => t.category !== "rest");
      if (newDay.length > 0) {
        setTasks((prev) => {
          const next = [...prev, ...newDay].sort(byScheduledTime);
          saveSnapshot(next, tasksDateRef.current);
          return next;
        });
      }
      if (newPool.length > 0) {
        setBacklogTasks((prev) => {
          const next = [...newPool, ...prev].sort(byCreatedAtDesc);
          saveBacklogSnapshot(next);
          return next;
        });
      }

      if (!isRemoteMode()) {
        onProgress?.(created.length, created.length);
        return created.length;
      }

      // 2) 串行写云端：先入队 → 成功后出队并用真实行替换临时 id
      const dateKey = tasksDateRef.current;
      created.forEach((t) =>
        enqueue({ type: "insert", task: t, dateKey, clientId: `ins-${t.id}` })
      );
      // 抑制 Realtime 回写，避免与本地的 id 替换互相覆盖
      suppressRemoteRef.current = true;

      let synced = 0;
      let done = 0;
      for (const task of created) {
        try {
          const saved = await supabaseTaskRepo.insertTask(task, dateKey);
          if (saved) {
            dequeue(`ins-${task.id}`);
            synced += 1;
            replaceTask(task.id, saved);
          }
        } catch (err) {
          console.warn("[FlowMirror] 批量导入中断（保留离线队列待补录）：", err);
        } finally {
          done += 1;
          onProgress?.(done, created.length);
        }
      }

      setTimeout(() => {
        suppressRemoteRef.current = false;
      }, 600);

      // 3) 未成功的条目仍在离线队列里，网络恢复后由 flushQueue 自动补录
      if (synced < created.length) {
        pushToast(`${created.length - synced} 项未同步到云端，已排队待补录`, "warn");
      }
      return created.length;
    },
    [pushToast, replaceTask]
  );

  /**
   * 删除任务。
   *
   * 三个容易踩的点：
   *  1) 本地必须**立刻**移除 —— 删除是用户明确表达的意图，不能等云端回执，
   *     否则慢网络下会出现「点了没反应」。快照同步落盘保证刷新后不复现。
   *  2) 若该任务尚未成功写入云端（仍在离线队列里，id 还是本地临时 id），
   *     必须把它的 insert 操作一并撤销；否则网络恢复后补录会把它「复活」。
   *  3) 只有服务端 uuid 才值得发起远端删除。本地临时 id（`task-xxx`）打给
   *     Supabase 会因 uuid 解析失败而报错，失败操作会永久留在队列里反复重试。
   *
   * 两个池都按 id 清一次：id 全局唯一，所以这是幂等的，也让「待执行池的删除」
   * 不需要先查它住在哪个池 —— 少一个可能失配的分支，就少一类「删了又回来」的 bug。
   */
  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveSnapshot(next, tasksDateRef.current);
      return next;
    });
    setBacklogTasks((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveBacklogSnapshot(next);
      return next;
    });
    // 关掉可能正指向该任务的详情 / 微复盘抽屉，避免留下指向已删数据的浮层
    setDetailTaskId((cur) => (cur === id ? null : cur));
    setReviewTaskId((cur) => (cur === id ? null : cur));

    if (!isRemoteMode()) return;

    const pendingInsert = loadQueue().find((op) => op.type === "insert" && op.task.id === id);
    if (pendingInsert) {
      dequeue(pendingInsert.clientId); // 还没落库：撤销补录即可，无需远端删除
      return;
    }
    if (!SERVER_ID.test(id)) return;

    const op: PendingOp = { type: "delete", id, clientId: `del-${id}` };
    enqueue(op);
    supabaseTaskRepo.deleteTask(id).then((ok) => {
      if (ok) dequeue(op.clientId);
    });
  }, []);

  // 解冻同样只针对当日看板（与 fuse 对称）：待执行池从未被冻结过
  const unfreeze = useCallback(() => {
    setCareMode(false);
    setTasks((prev) => {
      const next = prev.map((t) => (t.status === "frozen" ? { ...t, status: "pending" as const } : t));
      saveSnapshot(next, tasksDateRef.current);
      if (isRemoteMode()) {
        next.filter((t) => t.status === "pending").forEach((t) => {
          const op: PendingOp = { type: "update", task: t, clientId: `upd-${t.id}` };
          enqueue(op);
          supabaseTaskRepo.updateTask(t).then((ok) => {
            if (ok) dequeue(op.clientId);
          });
        });
      }
      return next;
    });
    pushToast("已解冻，欢迎回来。从最小的一步开始。", "success");
  }, [pushToast]);

  const openDetail = useCallback((id: string) => setDetailTaskId(id), []);
  const closeDetail = useCallback(() => setDetailTaskId(null), []);

  // 跨池查找：待执行池里的任务同样能打开详情 / 微复盘
  const reviewTask = reviewTaskId ? (findTask(reviewTaskId) ?? null) : null;
  const detailTask = detailTaskId ? (findTask(detailTaskId) ?? null) : null;

  const value: FlowContextValue = {
    tasks,
    backlogTasks,
    findTask,
    careMode,
    candleMode,
    reviewTaskId,
    reviewTask,
    detailTaskId,
    detailTask,
    toasts,
    synced,
    userEmail,
    signInWithEmail,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    selectedDate,
    setSelectedDate,
    today,
    isViewingToday,
    goToday,
    mirrorDate,
    setMirrorDate,
    yesterdayDate,
    isViewingYesterday,
    goYesterday,
    mirrorTasks,
    mirrorReady,
    yesterdayTasks,
    setTaskTime,
    startTiming,
    stopTiming,
    toggleTiming,
    renameTask,
    completeTask,
    reopenTask,
    moveTaskQuadrant,
    closeReview,
    submitReview,
    executeCommand,
    addTask,
    addTasks,
    deleteTask,
    unfreeze,
    openDetail,
    closeDetail,
    pushToast,
    syncNow,
    lastSyncedAt,
    syncing,
  };

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error("useFlow 必须在 FlowProvider 内使用");
  return ctx;
}

function byScheduledTime(a: Task, b: Task): number {
  return (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99");
}

/**
 * 「待执行清单」池的排序：**新记的排在最前**。
 * 与灵感流同向 —— 刚丢进池子的东西应该在你视线所在之处，而不是沉到底部。
 * 缺 createdAt 的历史数据排在最后（而不是被当成 1970 年顶到最前）。
 */
function byCreatedAtDesc(a: Task, b: Task): number {
  const ka = a.createdAt ?? "";
  const kb = b.createdAt ?? "";
  if (!ka && !kb) return 0;
  if (!ka) return 1;
  if (!kb) return -1;
  return kb.localeCompare(ka);
}

/**
 * 划分两个池的唯一判据：`rest`（待执行清单）是**全局常驻池**，其余按日归属。
 *
 * 与 `QUADRANT_META` / `CATEGORY_META` 的口径一致（q3 ↔ rest）。
 * 两个池严格互斥 —— 这是所有按 id 查找/写入逻辑能够保持简单的根基：
 * 一个任务只可能出现在一处，不需要处理「两边都有一份、改哪一份」的问题。
 */
function isDayPoolTask(task: Task): boolean {
  return task.category !== "rest";
}

/**
 * 服务端主键（Supabase uuid）判定。
 * 本地乐观新增的任务 id 形如 `task-lx9f2k`，直接拿去打 Supabase 会因 uuid
 * 解析失败而报错，失败的操作会一直滞留在离线队列里被反复重试。
 */
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Supabase Auth 英文错误 → 中文提示（覆盖常见登录/注册场景） */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("email_provider_disabled") || m.includes("email logins are disabled"))
    return "邮件登录未启用：请在 Supabase 控制台 Authentication → Providers 开启 Email";
  if (m.includes("invalid login credentials")) return "邮箱或密码不正确";
  if (m.includes("email not confirmed")) return "邮箱尚未验证，请先查收验证邮件";
  if (m.includes("user already registered") || m.includes("already been registered"))
    return "该邮箱已注册，请直接登录";
  if (m.includes("password should be at least")) return "密码至少 6 位";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "邮箱格式不正确";
  if (m.includes("rate limit") || m.includes("too many")) return "操作过于频繁，请稍后再试";
  if (m.includes("network") || m.includes("fetch")) return "网络异常，请检查网络后重试";
  return message;
}

/** Realtime 推送的 Supabase 行 → 前端 Task 模型（与 repository 保持一致） */
function rowToTaskLocal(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    // 枚举字段走 coerce：Realtime 推来的行同样可能带陌生值，
    // 而它落地后立刻参与渲染（查表 → 取色/取文案），脏值就是白屏
    status: coerceTaskStatus(row.status),
    category: coerceTaskCategory(row.category),
    scheduledTime: (row.scheduled_time as string) ?? undefined,
    plannedDuration: (row.planned_duration as number) ?? undefined,
    actualDuration: (row.actual_duration as number) ?? undefined,
    blackholeMinutes: (row.blackhole_minutes as number) ?? undefined,
    timeSlices: (row.time_slices as Task["timeSlices"]) ?? [],
    microReviews: (row.micro_reviews as Task["microReviews"]) ?? [],
    insights: (row.insights as string[]) ?? [],
    sops: (row.sops as string[]) ?? [],
    pitfalls: (row.pitfalls as string[]) ?? [],
    createdAt: (row.created_at as string) ?? undefined,
  };
}
