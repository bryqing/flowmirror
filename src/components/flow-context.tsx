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
  quadrantToCategory,
  type MicroReview,
  type ParsedCommand,
  type Quadrant,
  type Task,
  type TaskCategory,
} from "@/lib/types";
import { TODAY_TASKS } from "@/lib/mock-data";
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
  type PendingOp,
} from "@/lib/offline-store";

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
   * 前一天（相对今天，不跟随 selectedDate）的任务列表。
   * 昨日之镜的完成率等指标直接由它算出，不读 mock。
   */
  yesterdayTasks: Task[];
  /** 前一天的日期 key "YYYY-MM-DD" */
  yesterdayDate: string;
  /** 昨日任务是否已完成加载（本地快照 + 远端尝试都已结束） */
  yesterdayReady: boolean;
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
  // 关键：初始状态必须与 SSR 完全一致（一律 TODAY_TASKS）。
  // 本地快照的读取放在挂载后的 useEffect 中异步触发，避免 SSR 与客户端首帧水合差异。
  const [tasks, setTasks] = useState<Task[]>(TODAY_TASKS);
  /**
   * 「待执行清单」全局池（Q3）。
   *
   * 初值与 SSR 同源（演示数据里的 rest 条目，纯静态计算 → 首帧一致）；
   * 挂载后再由本地快照 / 云端全量集合接管。它与 `tasks` 是**并列的两个池**：
   * `tasks` 按 selectedDate 切片，这里永远全量。
   */
  const [backlogTasks, setBacklogTasks] = useState<Task[]>(() =>
    TODAY_TASKS.filter((t) => t.category === "rest")
  );
  const [careMode, setCareMode] = useState(false);
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [synced, setSynced] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => todayKey());
  /** 挂载后校准的「今天」。初值与 selectedDate 同源，SSR 与首帧一致，不产生水合差异 */
  const [today, setToday] = useState<string>(() => todayKey());
  /** 前一日任务（昨日之镜的数据源）。与 selectedDate 平行，始终是「今天 - 1 天」 */
  const [yesterdayTasks, setYesterdayTasks] = useState<Task[]>([]);
  const [yesterdayReady, setYesterdayReady] = useState(false);
  const yesterdayDate = useMemo(() => shiftDateKey(today, -1), [today]);

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
   * 某日无远程数据时的本地兜底：今日给演示数据，其余日期一律留空。
   *
   * ⚠️ 只返回**日池**任务（Q1/Q2/Q4）。「待执行清单」不在按日快照的语义里，
   * 若让它混进来，切到任意一天都会看到同一批 Q3 条目被当成「那天的任务」
   * 参与完成率、热力大盘等按日统计 —— 池子必须是另一个维度。
   */
  const localTasksFor = useCallback((dateKey: string): Task[] => {
    const snap = loadSnapshot(dateKey);
    const source = snap ?? (dateKey === todayRef.current ? TODAY_TASKS : []);
    return source.filter(isDayPoolTask);
  }, []);

  /**
   * 「待执行清单」全局池的本地兜底，按优先级：
   *   1) 池子自己的快照（空数组也是有效值，代表「用户把池子清空了」）；
   *   2) **迁移**：旧版本的 Q3 存在「今日快照」里，把它接过来，
   *      否则升级后用户会发现待执行清单凭空消失了；
   *   3) 演示数据里的 rest 条目（全新安装、纯本地演示）。
   */
  const localBacklog = useCallback((): Task[] => {
    const snap = loadBacklogSnapshot();
    if (snap) return snap;
    const day = loadSnapshot(todayRef.current) ?? TODAY_TASKS;
    return day.filter((t) => t.category === "rest");
  }, []);

  /** 跨池查任务：日看板 + 全局池。按 id 定位的读路径（详情/复盘/编辑）一律用它 */
  const findTask = useCallback(
    (id: string): Task | undefined =>
      tasks.find((t) => t.id === id) ?? backlogTasks.find((t) => t.id === id),
    [tasks, backlogTasks]
  );

  const isViewingToday = selectedDate === today;

  const goToday = useCallback(() => setSelectedDate(today), [today]);

  // 远程写入开关：避免在 Realtime 回调里重复回写
  const suppressRemoteRef = useRef(false);

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

  // ---- 装载「待执行清单」全局池：只跑一次（本地快照 / 迁移 / 演示数据）----
  //
  // 刻意**不依赖 selectedDate**：换日期不该让这个池重新装载，
  // 那正是「原来切一天池子就空掉」的成因。云端数据由会话建立时拉取（见下方 effect）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBacklogTasks(localBacklog());
  }, [localBacklog]);

  // ---- 加载昨日任务（昨日之镜的真实指标数据源）----
  //
  // 与「当前查看日期」的装载刻意分开：昨日之镜永远看的是今天的前一天，
  // 用户翻到别的历史日期时它不该跟着变，否则「昨日之镜」会显示成上月某天。
  //
  // ⚠️ 远端结果只在**非空**时采纳。未登录 / RLS 未命中时 Supabase 返回的是
  //    空数组而非错误，拿它覆盖本地快照会把用户昨天离线记录的任务抹掉。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    void (async () => {
      const snap = loadSnapshot(yesterdayDate);
      if (!cancelled && snap) setYesterdayTasks(snap);
      if (isSupabaseConfigured()) {
        const remote = await fetchTasksOrNull(yesterdayDate);
        if (!cancelled && remote && remote.length > 0) {
          setYesterdayTasks(remote);
          saveSnapshot(remote, yesterdayDate);
        }
      }
      if (!cancelled) setYesterdayReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [yesterdayDate, synced]);

  // ---- 切换查看日期时拉取该日云端任务（已登录才发）----
  // 快照已在上面同步渲染，这里只做「补齐/纠正」，所以不阻塞首屏、也不闪空列表。
  useEffect(() => {
    if (typeof window === "undefined" || !isSupabaseConfigured()) return;
    if (!userIdRef.current) return;
    let cancelled = false;
    void (async () => {
      const remote = await fetchTasksOrNull(selectedDate);
      if (cancelled || remote === null) return;
      // 只收日池：待执行清单由全局池单独维护，按日拉取时把它剔掉，
      // 否则同一条 Q3 会同时出现在两个池里（改一处、另一处还是旧的）。
      const dayTasks = remote.filter(isDayPoolTask);
      // 今日云端为空时保留本地数据（首次登录可把本地任务推上去）；
      // 历史日期为空就应当是空的 —— 空列表本身是有效结果，要如实呈现。
      if (dayTasks.length === 0 && selectedDate === todayRef.current) return;
      tasksDateRef.current = selectedDate;
      setTasks(dayTasks);
      saveSnapshot(dayTasks, selectedDate);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

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

    /**
     * 采纳云端返回的「待执行清单」全局池。
     *
     * 与日看板刻意采用**不同**的空值策略：
     *   · 非空 → 无条件采纳（云端是权威）。
     *   · 空   → 仅当离线队列里没有「还没推上去的条目」时才采纳。
     *
     * 日看板那种「空就一律保留本地」是为了不把首次登录的本地任务推掉，
     * 但那会让「在手机上清空了池子」永远同步不过来。
     * 这里用「离线队列是否为空」做判据，两种意图都能满足：
     * 刚在断网时记下的条目不会被一次空响应抹掉，而真正清空则如实生效。
     */
    const adoptBacklog = (remote: Task[]) => {
      if (remote.length === 0 && loadQueue().length > 0) return;
      setBacklogTasks((prev) => {
        if (sameTaskList(prev, remote)) return prev;
        saveBacklogSnapshot(remote);
        return remote;
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

    // ---- 轮询回补：代理模式下 Realtime 的等价替代 ----
    // 页面可见时每 30s 拉一次云端任务；失败保持本地状态，绝不回退 mock。
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollInFlight = false;

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const pollOnce = async () => {
      // 后台标签页不轮询（省电省流量）；回到前台会立即补一次
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (pollInFlight) return;
      // 有未补录的本地写入时先按兵不动，避免覆盖刚产生的本地改动
      if (loadQueue().length > 0) return;
      pollInFlight = true;
      try {
        const dateKey = selectedDateRef.current;
        // 两个池并行拉：日看板带 date 过滤，待执行池不带（全量集合）
        const [remote, backlogRemote] = await Promise.all([
          fetchTasksOrNull(dateKey),
          fetchBacklogOrNull(),
        ]);
        if (cancelled) return;
        if (remote) {
          const dayTasks = remote.filter(isDayPoolTask);
          // 今日云端为空 → 保留本地（可能是还没推上去的离线任务）
          if (!(dayTasks.length === 0 && dateKey === todayRef.current)) {
            setTasks((prev) => {
              if (sameTaskList(prev, dayTasks)) return prev; // 无变化则不触发重渲染
              saveSnapshot(dayTasks, dateKey);
              return dayTasks;
            });
          }
        }
        if (backlogRemote) adoptBacklog(backlogRemote);
      } catch (err) {
        console.warn("[FlowMirror] 轮询同步失败（保持本地状态）：", err);
      } finally {
        pollInFlight = false;
      }
    };

    const startPolling = () => {
      if (isRealtimeAvailable()) return; // 有 Realtime 就无需轮询
      stopPolling();
      pollTimer = setInterval(() => void pollOnce(), 30_000);
    };

    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void pollOnce();
      }
    };

    /** 建立已登录会话：拉取云端任务 → 切换已同步 → 订阅 Realtime / 启动轮询 */
    const attachRemoteSession = async (userId: string, email: string | null) => {
      userIdRef.current = userId;
      setUserEmail(email);
      // 拉取「当前正在查看的那天」，而不是死板地拉今天
      const dateKey = selectedDateRef.current;
      // 两个池并行拉：日看板按日过滤，待执行清单是全量集合
      const [remote, backlogRemote] = await Promise.all([
        supabaseTaskRepo.fetchTasks(dateKey),
        fetchBacklogOrNull(),
      ]);
      if (cancelled) return;
      const dayTasks = remote.filter(isDayPoolTask);
      // 云端有数据则覆盖本地；为空则保留当前本地数据（首次登录可把本地任务推上去）
      if (dayTasks.length > 0) {
        tasksDateRef.current = dateKey;
        setTasks(dayTasks);
        saveSnapshot(dayTasks, dateKey);
      }
      if (backlogRemote) adoptBacklog(backlogRemote);
      setSynced(true);
      subscribeTasks(userId);
      startPolling();
    };

    /** 清除已登录会话：回退到本地数据（当日快照优先，今日无快照才用演示数据） */
    const detachRemoteSession = () => {
      userIdRef.current = null;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      stopPolling();
      setUserEmail(null);
      setSynced(false);
      const dateKey = selectedDateRef.current;
      tasksDateRef.current = dateKey;
      setTasks(localTasksFor(dateKey));
      // 全局池回到它自己的本地快照（与日期无关，所以不随 dateKey 变）
      setBacklogTasks(localBacklog());
    };

    (async () => {
      const userId = await currentUserId();
      if (cancelled) return;
      if (!userId) return; // 未登录：保持本地快照 / mock，不订阅
      const email = (await supabase.auth.getUser()).data.user?.email ?? null;
      if (cancelled) return;
      await attachRemoteSession(userId, email);
    })();

    // 监听认证状态变化（登录 / 登出 / 令牌刷新）——保证密码登录后立即拉取云端数据。
    //
    // ⚠️ 必须区分「从未登录」与「从登录态退出」：
    //    supabase-js 在 subscribe 的瞬间会补发一次 INITIAL_SESSION，未登录时其 session 为 null。
    //    若此时直接走 detachRemoteSession()，会把上面 effect 刚从本地快照恢复出来的任务
    //    重新覆盖成演示数据（TODAY_TASKS）—— 表现为「离线期间的增删改，一刷新就全部丢失」。
    //    只有真正经历过登录再登出，才该回退演示数据（顺带避免把账号数据留在登出后的界面上）。
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

    // 5. 网络恢复：补录离线队列
    const flushQueue = async () => {
      const pending = loadQueue();
      if (pending.length === 0) return;
      const userId = await currentUserId();
      if (!userId) return; // 未登录不补录（等下次登录）

      for (const op of pending) {
        if (cancelled) return;
        let ok = false;
        if (op.type === "insert") {
          const saved = await supabaseTaskRepo.insertTask(op.task, op.dateKey);
          ok = saved !== null;
        } else if (op.type === "update") {
          ok = await supabaseTaskRepo.updateTask(op.task);
        } else if (op.type === "delete") {
          ok = await supabaseTaskRepo.deleteTask(op.id);
        }
        if (ok) dequeue(op.clientId);
      }
      // 补录完成后刷新一次远程，确保状态一致（刷新当前查看的那天 + 全局池）
      const dateKey = selectedDateRef.current;
      const [refreshed, backlogRefreshed] = await Promise.all([
        supabaseTaskRepo.fetchTasks(dateKey),
        fetchBacklogOrNull(),
      ]);
      if (cancelled) return;
      const dayTasks = refreshed.filter(isDayPoolTask);
      if (dayTasks.length > 0) {
        tasksDateRef.current = dateKey;
        setTasks(dayTasks);
        saveSnapshot(dayTasks, dateKey);
      }
      if (backlogRefreshed) adoptBacklog(backlogRefreshed);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", flushQueue);
    }
    if (typeof document !== "undefined") {
      // 从后台切回前台时立即补一次轮询，避免用户看到过期数据
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      stopPolling();
      if (channel) {
        getSupabase().removeChannel(channel);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", flushQueue);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [pushToast, localTasksFor, localBacklog]);

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
        const next = prev.map((t) => (t.id === updated.id ? updated : t)).sort(byScheduledTime);
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
        timeSlices: [...target.timeSlices, { start: nowClock(), end: "", label: target.title }],
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
      const index = target.timeSlices.findIndex((s) => Boolean(s.start) && !s.end);
      if (index < 0) return;
      const closed = target.timeSlices.map((s, i) =>
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
      if (target) commitTask({ ...target, microReviews: [...target.microReviews, full] });
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
    yesterdayTasks,
    yesterdayDate,
    yesterdayReady,
    setTaskTime,
    startTiming,
    stopTiming,
    toggleTiming,
    renameTask,
    completeTask,
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
    title: String(row.title),
    status: row.status as Task["status"],
    category: row.category as Task["category"],
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
