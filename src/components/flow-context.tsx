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
import { uid } from "@/lib/utils";
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
  todayKey,
} from "@/lib/task-repository";
import {
  loadSnapshot,
  saveSnapshot,
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
  tasks: Task[];
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
  const [careMode, setCareMode] = useState(false);
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [synced, setSynced] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => todayKey());
  /** 挂载后校准的「今天」。初值与 selectedDate 同源，SSR 与首帧一致，不产生水合差异 */
  const [today, setToday] = useState<string>(() => todayKey());

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

  /** 某日无远程数据时的本地兜底：今日给演示数据，其余日期一律留空 */
  const localTasksFor = useCallback((dateKey: string): Task[] => {
    const snap = loadSnapshot(dateKey);
    if (snap) return snap;
    return dateKey === todayRef.current ? TODAY_TASKS : [];
  }, []);

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

  // ---- 切换查看日期时拉取该日云端任务（已登录才发）----
  // 快照已在上面同步渲染，这里只做「补齐/纠正」，所以不阻塞首屏、也不闪空列表。
  useEffect(() => {
    if (typeof window === "undefined" || !isSupabaseConfigured()) return;
    if (!userIdRef.current) return;
    let cancelled = false;
    void (async () => {
      const remote = await fetchTasksOrNull(selectedDate);
      if (cancelled || remote === null) return;
      // 今日云端为空时保留本地数据（首次登录可把本地任务推上去）；
      // 历史日期为空就应当是空的 —— 空列表本身是有效结果，要如实呈现。
      if (remote.length === 0 && selectedDate === todayRef.current) return;
      tasksDateRef.current = selectedDate;
      setTasks(remote);
      saveSnapshot(remote, selectedDate);
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
            const row = payload.new as Record<string, unknown>;
            // 只吸收「当前查看日期」的变更：看板可能停在历史日期上，
            // 若把其他日期的行也塞进来，历史视图里会凭空多出今天的任务。
            const rowDate =
              typeof row.date === "string"
                ? row.date
                : (payload.old as { date?: string } | null)?.date;
            if (rowDate && rowDate !== selectedDateRef.current) return;
            setTasks((prev) => {
              const next = (() => {
                switch (payload.eventType) {
                  case "INSERT":
                    return [...prev, rowToTaskLocal(row)].sort(byScheduledTime);
                  case "UPDATE": {
                    const updated = rowToTaskLocal(row);
                    return prev.map((t) => (t.id === updated.id ? updated : t));
                  }
                  case "DELETE":
                    return prev.filter((t) => t.id !== (payload.old as { id?: string })?.id);
                  default:
                    return prev;
                }
              })();
              saveSnapshot(next, selectedDateRef.current);
              return next;
            });
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
        const remote = await fetchTasksOrNull(dateKey);
        if (cancelled || !remote) return;
        // 今日云端为空 → 保留本地（可能是还没推上去的离线任务）
        if (remote.length === 0 && dateKey === todayRef.current) return;
        setTasks((prev) => {
          if (sameTaskList(prev, remote)) return prev; // 无变化则不触发重渲染
          saveSnapshot(remote, dateKey);
          return remote;
        });
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
      const remote = await supabaseTaskRepo.fetchTasks(dateKey);
      if (cancelled) return;
      // 云端有数据则覆盖本地；为空则保留当前本地数据（首次登录可把本地任务推上去）
      if (remote.length > 0) {
        tasksDateRef.current = dateKey;
        setTasks(remote);
        saveSnapshot(remote, dateKey);
      }
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
      // 补录完成后刷新一次远程，确保状态一致（刷新当前查看的那天）
      const dateKey = selectedDateRef.current;
      const refreshed = await supabaseTaskRepo.fetchTasks(dateKey);
      if (!cancelled && refreshed.length > 0) {
        tasksDateRef.current = dateKey;
        setTasks(refreshed);
        saveSnapshot(refreshed, dateKey);
      }
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
  }, [pushToast, localTasksFor]);

  const completeTask = useCallback((id: string) => {
    setTasks((prev) => {
      const next = prev.map((t) =>
        t.id === id && t.status !== "done"
          ? { ...t, status: "done" as const, actualDuration: t.actualDuration ?? t.plannedDuration }
          : t
      );
      // 本地快照兜底
      saveSnapshot(next, tasksDateRef.current);
      // 远程同步写库（失败入队，网络恢复补录）
      const updated = next.find((t) => t.id === id);
      if (updated && isRemoteMode()) {
        const op: PendingOp = { type: "update", task: updated, clientId: `upd-${id}` };
        enqueue(op);
        supabaseTaskRepo.updateTask(updated).then((ok) => {
          if (ok) dequeue(op.clientId);
        });
      }
      return next;
    });
    setReviewTaskId(id);
  }, []);

  const closeReview = useCallback(() => setReviewTaskId(null), []);

  const submitReview = useCallback(
    (id: string, review: Omit<MicroReview, "id" | "createdAt">) => {
      const full: MicroReview = {
        ...review,
        id: uid("mr"),
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      };
      setTasks((prev) => {
        const next = prev.map((t) =>
          t.id === id ? { ...t, microReviews: [...t.microReviews, full] } : t
        );
        saveSnapshot(next, tasksDateRef.current);
        const updated = next.find((t) => t.id === id);
        if (updated && isRemoteMode()) {
          const op: PendingOp = { type: "update", task: updated, clientId: `upd-${id}-${full.id}` };
          enqueue(op);
          supabaseTaskRepo.updateTask(updated).then((ok) => {
            if (ok) dequeue(op.clientId);
          });
        }
        return next;
      });
      setReviewTaskId(null);
      pushToast("微复盘已入库，经验卡片 +1", "success");
    },
    [pushToast]
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
    pushToast("已退出登录，回到本地模式", "info");
  }, [localTasksFor, pushToast]);

  /**
   * AI 象限复核 —— 只在本地方案「没底气」时调用。
   *
   * 命令条追求的是**即时**录入，所以先用本地规则（`classifyQuadrant`）判定；
   * 规则由 QUADRANT_META 判据拆解而来，常见表达都能命中。只有一句话里没有任何
   * 可识别的信号（`confident: false`，兜底成了 q3）时，才追加一次 AI 复核 ——
   * 复用与「AI 速记」完全相同的端点与判据，结论一致就什么都不做，
   * 不一致才把任务挪到正确象限并**明确告知用户**（不静默改用户的东西）。
   */
  const refineTaskQuadrant = useCallback(
    async (taskId: string, title: string, localQuadrant: Quadrant) => {
      const local = tasks.find((t) => t.id === taskId);
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
        setTasks((prev) => {
          const next = prev.map((t) => (t.id === taskId ? updatedTask : t));
          saveSnapshot(next, tasksDateRef.current);
          return next;
        });
        // 同步云端（本地临时 id 还没落库，等 flushQueue 补录时会带上新分类）
        if (isRemoteMode() && SERVER_ID.test(updatedTask.id)) {
          const op: PendingOp = { type: "update", task: updatedTask, clientId: `upd-${updatedTask.id}` };
          enqueue(op);
          supabaseTaskRepo.updateTask(updatedTask).then((ok) => {
            if (ok) dequeue(op.clientId);
          });
        }
        pushToast(`AI 复核后归入【${QUADRANT_META[refined].label}】`, "info");
      } catch (err) {
        console.warn("[FlowMirror] AI 象限复核失败（保留本地判定）：", err);
      }
    },
    [pushToast, tasks]
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
          };
          const dateKey = tasksDateRef.current;
          setTasks((prev) => {
            const next = [...prev, task].sort(byScheduledTime);
            saveSnapshot(next, tasksDateRef.current);
            return next;
          });
          if (isRemoteMode()) {
            const op: PendingOp = { type: "insert", task, dateKey, clientId: `ins-${task.id}` };
            enqueue(op);
            supabaseTaskRepo.insertTask(task, dateKey).then((saved) => {
              if (saved) {
                dequeue(op.clientId);
                // 用服务端返回的真实 id 替换本地临时 id
                suppressRemoteRef.current = true;
                setTasks((prev) => {
                  const next = prev.map((t) => (t.id === task.id ? saved : t)).sort(byScheduledTime);
                  saveSnapshot(next, tasksDateRef.current);
                  return next;
                });
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
          const target = tasks.find(
            (t) => t.title.includes(cmd.keyword) && t.status !== "done"
          );
          if (target) {
            const updated: Task = {
              ...target,
              scheduledTime: cmd.time ?? target.scheduledTime,
              status: "pending" as const,
            };
            setTasks((prev) => {
              const next = prev.map((t) => (t.id === target.id ? updated : t));
              saveSnapshot(next, tasksDateRef.current);
              return next;
            });
            if (isRemoteMode()) {
              const op: PendingOp = { type: "update", task: updated, clientId: `upd-${target.id}` };
              enqueue(op);
              supabaseTaskRepo.updateTask(updated).then((ok) => {
                if (ok) dequeue(op.clientId);
              });
            }
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
          };
          setTasks((prev) => {
            const next = [...prev, task].sort(byScheduledTime);
            saveSnapshot(next, tasksDateRef.current);
            return next;
          });
          if (isRemoteMode()) {
            const bhDateKey = tasksDateRef.current;
            const op: PendingOp = { type: "insert", task, dateKey: bhDateKey, clientId: `ins-${task.id}` };
            enqueue(op);
            supabaseTaskRepo.insertTask(task, bhDateKey).then((saved) => {
              if (saved) {
                dequeue(op.clientId);
                suppressRemoteRef.current = true;
                setTasks((prev) => {
                  const next = prev.map((t) => (t.id === task.id ? saved : t)).sort(byScheduledTime);
                  saveSnapshot(next, tasksDateRef.current);
                  return next;
                });
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
    [pushToast, tasks, refineTaskQuadrant]
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
      };
      setTasks((prev) => {
        const next = [...prev, task].sort(byScheduledTime);
        saveSnapshot(next, tasksDateRef.current);
        return next;
      });
      if (isRemoteMode()) {
        const dateKey = tasksDateRef.current;
        const op: PendingOp = { type: "insert", task, dateKey, clientId: `ins-${task.id}` };
        enqueue(op);
        try {
          const saved = await supabaseTaskRepo.insertTask(task, dateKey);
          if (saved) {
            dequeue(op.clientId);
            suppressRemoteRef.current = true;
            setTasks((prev) => {
              const next = prev.map((t) => (t.id === task.id ? saved : t)).sort(byScheduledTime);
              saveSnapshot(next, tasksDateRef.current);
              return next;
            });
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
    []
  );

  /**
   * 批量新增任务（AI 战局速记「确认导入」）。
   *
   * 与单条 addTask 同一套降级策略，但云端写入**串行**而非批量 insert：
   * batch insert 的返回行顺序没有可靠保证，一旦与请求顺序错位，
   * 本地任务就会持有别人的服务端 id —— 之后任何更新/删除都会打错行。
   * 串行慢一点，但每一条都能拿到确定的 id。
   */
  const addTasks = useCallback(
    async (
      items: { title: string; category: TaskCategory }[],
      onProgress?: (done: number, total: number) => void
    ): Promise<number> => {
      const list = items.filter((it) => it.title.trim().length > 0);
      if (list.length === 0) return 0;

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
      }));

      // 1) 先乐观落界面 + 本地快照 —— 点了就必须有反应，云端失败也不留空白
      setTasks((prev) => {
        const next = [...prev, ...created].sort(byScheduledTime);
        saveSnapshot(next, tasksDateRef.current);
        return next;
      });

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
            setTasks((prev) => {
              const next = prev
                .map((t) => (t.id === task.id ? saved : t))
                .sort(byScheduledTime);
              saveSnapshot(next, tasksDateRef.current);
              return next;
            });
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
    [pushToast]
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
   */
  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveSnapshot(next, tasksDateRef.current);
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

  const reviewTask = tasks.find((t) => t.id === reviewTaskId) ?? null;
  const detailTask = tasks.find((t) => t.id === detailTaskId) ?? null;

  const value: FlowContextValue = {
    tasks,
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

function nowClock(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
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
  };
}
