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
import type { MicroReview, ParsedCommand, Task, TaskCategory } from "@/lib/types";
import { TODAY_TASKS } from "@/lib/mock-data";
import { uid } from "@/lib/utils";
import {
  getSupabase,
  isSupabaseConfigured,
  currentUserId,
} from "@/lib/supabase";
import {
  isRemoteMode,
  supabaseTaskRepo,
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
  /** 当前选中日期 key "YYYY-MM-DD"（联动日历回查灵感/历史） */
  selectedDate: string;
  setSelectedDate: (key: string) => void;
  completeTask: (id: string) => void;
  closeReview: () => void;
  submitReview: (id: string, review: Omit<MicroReview, "id" | "createdAt">) => void;
  executeCommand: (cmd: ParsedCommand) => void;
  /** 直接新增任务到指定象限，返回新任务 id（供「灵感转待办」等场景复用） */
  addTask: (title: string, category: TaskCategory) => Promise<string>;
  unfreeze: () => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  pushToast: (message: string, tone?: Toast["tone"]) => void;
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

  // ---- 挂载后异步读取本地快照（离线兜底）----
  // 仅在客户端、且尚未登录时生效；登录态下由下方 Supabase 拉取远程数据覆盖。
  // 放在 effect 中异步触发，确保 SSR 首帧与客户端首帧都渲染 mock，彻底斩断水合差异。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const snap = loadSnapshot();
    if (snap && snap.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTasks(snap);
    }
  }, []);

  // ---- Supabase 初始化：登录态检测 + 拉取远程任务 + Realtime 订阅 + 离线回退 ----
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let channel: ReturnType<ReturnType<typeof getSupabase>["channel"]> | null = null;
    let cancelled = false;
    const supabase = getSupabase();

    /** 订阅 tasks 表 Realtime（多端实时同步），重复调用前先断开旧订阅 */
    const subscribeTasks = (userId: string) => {
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
              saveSnapshot(next);
              return next;
            });
          }
        )
        .subscribe();
    };

    /** 建立已登录会话：拉取云端任务 → 切换已同步 → 订阅 Realtime */
    const attachRemoteSession = async (userId: string, email: string | null) => {
      setUserEmail(email);
      const dateKey = todayKey();
      const remote = await supabaseTaskRepo.fetchTasks(dateKey);
      if (cancelled) return;
      // 云端有数据则覆盖本地；为空则保留当前本地数据（首次登录可把本地任务推上去）
      if (remote.length > 0) {
        setTasks(remote);
        saveSnapshot(remote);
      }
      setSynced(true);
      subscribeTasks(userId);
    };

    /** 清除已登录会话：回退本地 */
    const detachRemoteSession = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      setUserEmail(null);
      setSynced(false);
      setTasks(TODAY_TASKS);
    };

    (async () => {
      const userId = await currentUserId();
      if (cancelled) return;
      if (!userId) return; // 未登录：保持本地快照 / mock，不订阅
      const email = (await supabase.auth.getUser()).data.user?.email ?? null;
      if (cancelled) return;
      await attachRemoteSession(userId, email);
    })();

    // 监听认证状态变化（登录 / 登出 / 令牌刷新）——保证密码登录后立即拉取云端数据
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session?.user) {
        void attachRemoteSession(session.user.id, session.user.email ?? null);
      } else {
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
      // 补录完成后刷新一次远程，确保状态一致
      const dateKey = todayKey();
      const refreshed = await supabaseTaskRepo.fetchTasks(dateKey);
      if (!cancelled && refreshed.length > 0) {
        setTasks(refreshed);
        saveSnapshot(refreshed);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", flushQueue);
    }

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      if (channel) {
        getSupabase().removeChannel(channel);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", flushQueue);
      }
    };
  }, [pushToast]);

  const completeTask = useCallback((id: string) => {
    setTasks((prev) => {
      const next = prev.map((t) =>
        t.id === id && t.status !== "done"
          ? { ...t, status: "done" as const, actualDuration: t.actualDuration ?? t.plannedDuration }
          : t
      );
      // 本地快照兜底
      saveSnapshot(next);
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
        saveSnapshot(next);
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
    setTasks(TODAY_TASKS);
    pushToast("已退出登录，回到本地演示模式", "info");
  }, [pushToast]);

  const executeCommand = useCallback(
    (cmd: ParsedCommand) => {
      switch (cmd.intent) {
        case "add": {
          const task: Task = {
            id: uid("task"),
            title: cmd.title,
            status: "pending",
            category: "deep-work",
            scheduledTime: cmd.time,
            plannedDuration: 50,
            timeSlices: [],
            microReviews: [],
            insights: [],
            sops: ["先拆出第一步最小动作", "定时器 25 分钟，先跑一个番茄钟", "完成比完美重要"],
            pitfalls: [],
          };
          setTasks((prev) => {
            const next = [...prev, task].sort(byScheduledTime);
            saveSnapshot(next);
            return next;
          });
          if (isRemoteMode()) {
            const op: PendingOp = { type: "insert", task, dateKey: todayKey(), clientId: `ins-${task.id}` };
            enqueue(op);
            supabaseTaskRepo.insertTask(task, todayKey()).then((saved) => {
              if (saved) {
                dequeue(op.clientId);
                // 用服务端返回的真实 id 替换本地临时 id
                suppressRemoteRef.current = true;
                setTasks((prev) => {
                  const next = prev.map((t) => (t.id === task.id ? saved : t)).sort(byScheduledTime);
                  saveSnapshot(next);
                  return next;
                });
                setTimeout(() => { suppressRemoteRef.current = false; }, 500);
              }
            });
          }
          pushToast(cmd.summary, "success");
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
              saveSnapshot(next);
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
            saveSnapshot(next);
            return next;
          });
          if (isRemoteMode()) {
            const op: PendingOp = { type: "insert", task, dateKey: todayKey(), clientId: `ins-${task.id}` };
            enqueue(op);
            supabaseTaskRepo.insertTask(task, todayKey()).then((saved) => {
              if (saved) {
                dequeue(op.clientId);
                suppressRemoteRef.current = true;
                setTasks((prev) => {
                  const next = prev.map((t) => (t.id === task.id ? saved : t)).sort(byScheduledTime);
                  saveSnapshot(next);
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
            saveSnapshot(next);
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
    [pushToast, tasks]
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
        saveSnapshot(next);
        return next;
      });
      if (isRemoteMode()) {
        const op: PendingOp = { type: "insert", task, dateKey: todayKey(), clientId: `ins-${task.id}` };
        enqueue(op);
        const saved = await supabaseTaskRepo.insertTask(task, todayKey());
        if (saved) {
          dequeue(op.clientId);
          suppressRemoteRef.current = true;
          setTasks((prev) => {
            const next = prev.map((t) => (t.id === task.id ? saved : t)).sort(byScheduledTime);
            saveSnapshot(next);
            return next;
          });
          setTimeout(() => { suppressRemoteRef.current = false; }, 500);
          return saved.id;
        }
      }
      return task.id;
    },
    []
  );

  const unfreeze = useCallback(() => {
    setCareMode(false);
    setTasks((prev) => {
      const next = prev.map((t) => (t.status === "frozen" ? { ...t, status: "pending" as const } : t));
      saveSnapshot(next);
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
    completeTask,
    closeReview,
    submitReview,
    executeCommand,
    addTask,
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
