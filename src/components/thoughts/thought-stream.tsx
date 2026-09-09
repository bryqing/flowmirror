"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Lightbulb,
  WandSparkles,
  Loader2,
  Trash2,
  Plus,
  Search,
  ListTodo,
  CheckCircle2,
  Tag,
  X,
} from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { thoughtRepo } from "@/lib/thought-repository";
import { useAiStream } from "@/lib/use-ai-stream";
import { extractTags, stripTags } from "@/lib/tags";
import { CATEGORY_META, type Task, type TaskCategory, type Thought } from "@/lib/types";
import { TaskPickerDialog } from "@/components/thoughts/task-picker-dialog";
import { cn } from "@/lib/utils";

/**
 * 灵感 / 思考流（Spark / Thought Stream）
 * - 随记闪念，不与执行任务混淆
 * - 支持 #标签 语法解析 + 标签胶囊即时筛选 + 关键词搜索
 * - 每卡支持「拓展思路」（DeepSeek 流式）+「转为待办」（四象限入格）
 * - 按全局选中日期归档回查；「全部搜索」模式可打破单日限制检索历史
 */
export function ThoughtStream() {
  const { selectedDate, tasks, addTask, pushToast } = useFlow();

  // 灵感列表（当前视口）：按日 or 全部检索
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [input, setInput] = useState("");
  const [loadedDate, setLoadedDate] = useState<string | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);

  // 检索状态
  const [keyword, setKeyword] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // 是否处于「全部搜索」模式（有检索意图时打破单日限制）
  const searchMode = keyword.trim().length > 0 || activeTag !== null;

  // 转待办弹窗
  const [pickerThought, setPickerThought] = useState<Thought | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // 加载中 = 尚未完成当前视口的加载（派生，避免在 effect 里同步 setState）
  const loading = !searchMode && loadedDate !== selectedDate;

  // 流式拓展
  const { reply: expandText, streaming, error: expandError, send: streamExpand } =
    useAiStream("/api/ai/expand-thought");

  // 拉取数据：按日 or 全量（selectedDate / searchMode 变化时触发）
  useEffect(() => {
    let cancelled = false;
    if (searchMode) {
      thoughtRepo.fetchAll().then((list) => {
        if (cancelled) return;
        setThoughts(list);
        setLoadedDate(null);
      });
    } else {
      thoughtRepo.fetchByDate(selectedDate).then((list) => {
        if (cancelled) return;
        setThoughts(list);
        setLoadedDate(selectedDate);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedDate, searchMode]);

  // 常用标签（从当前列表聚合，按出现频次排序）
  const allTags = useMemo(() => {
    const counter = new Map<string, number>();
    for (const t of thoughts) {
      for (const tag of t.tags) {
        counter.set(tag, (counter.get(tag) ?? 0) + 1);
      }
    }
    return [...counter.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [thoughts]);

  // 本地过滤：关键词（content / aiExpansion）+ 选中标签
  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return thoughts.filter((t) => {
      if (activeTag && !t.tags.includes(activeTag)) return false;
      if (!kw) return true;
      return (
        t.content.toLowerCase().includes(kw) ||
        t.aiExpansion.toLowerCase().includes(kw) ||
        t.tags.some((tag) => tag.toLowerCase().includes(kw))
      );
    });
  }, [thoughts, keyword, activeTag]);

  // 新增一条灵感（解析 #标签，正文去除标签符号）
  const addThought = async () => {
    const text = input.trim();
    if (!text) return;
    const tags = extractTags(text);
    const content = stripTags(text) || text;
    try {
      const saved = await thoughtRepo.insert(content, selectedDate, tags);
      if (saved) {
        setInput("");
        setThoughts((prev) => [saved, ...prev]);
        pushToast("灵感已记录", "success");
      } else {
        // insert 返回 null：明确失败，保留输入内容，提示用户
        pushToast("记录失败，请检查网络后重试", "danger");
      }
    } catch (e) {
      // 兜底：任何未预期异常都不静默吞掉，保留输入并提示
      console.error("[FlowMirror] 记录灵感异常：", e);
      pushToast("记录灵感时出错，请稍后重试", "danger");
    }
  };

  // 拓展某条灵感
  const expandThought = async (id: string, content: string) => {
    if (streaming) return;
    setExpandingId(id);
    const full = await streamExpand({ content });
    if (full) {
      await thoughtRepo.update(id, { aiExpansion: full });
      setThoughts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, aiExpansion: full } : t))
      );
    }
    setExpandingId(null);
  };

  // 删除灵感
  const removeThought = async (id: string) => {
    const ok = await thoughtRepo.remove(id);
    if (ok) setThoughts((prev) => prev.filter((t) => t.id !== id));
  };

  // 灵感转待办：选象限 → 建任务 → 回写关联
  const handlePickQuadrant = async (category: TaskCategory) => {
    const thought = pickerThought;
    if (!thought) return;
    setPickerThought(null);
    setConvertingId(thought.id);
    const taskId = await addTask(stripTags(thought.content) || thought.content, category);
    if (taskId) {
      await thoughtRepo.update(thought.id, { taskId });
      setThoughts((prev) =>
        prev.map((t) => (t.id === thought.id ? { ...t, taskId } : t))
      );
      pushToast("已转为待办并放入象限", "success");
    } else {
      pushToast("转待办失败，请重试", "danger");
    }
    setConvertingId(null);
  };

  return (
    <section className="flex flex-col gap-4">
      {/* 区块标题 */}
      <div className="flex items-end justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Lightbulb className="size-4 text-candle" />
          灵感与思考
          <span className="font-normal text-subtle-foreground">Thought Stream · 随记闪念</span>
        </h3>
        <p className="text-[11px] text-subtle-foreground">
          {searchMode ? `${visible.length} 条命中` : `${thoughts.length} 条`}
        </p>
      </div>

      {/* 输入区 */}
      <div className="glass animate-fade-up flex flex-col gap-2 rounded-2xl p-3.5">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="记下一个闪念、灵感或此刻的思绪… 可用 #标签 归类（如 #工作 #生活）"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addThought();
          }}
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-subtle-foreground">Ctrl / ⌘ + Enter 快速记录 · 支持 #标签</p>
          <Button size="sm" onClick={addThought} disabled={!input.trim()} className="gap-1">
            <Plus className="size-3.5" />
            记下
          </Button>
        </div>
      </div>

      {/* 搜索与标签过滤栏 */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={searchMode ? "搜索全部灵感（打破单日限制）…" : "搜索当前日期的灵感…"}
            className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-8 text-sm text-foreground placeholder:text-subtle-foreground outline-none transition-all focus:border-cat-deep/40 focus:ring-2 focus:ring-ring"
          />
          {keyword && (
            <button
              onClick={() => setKeyword("")}
              aria-label="清空搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setActiveTag(null)}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                activeTag === null
                  ? "border-candle/40 bg-candle/15 text-candle"
                  : "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]"
              )}
            >
              <Tag className="size-3" />
              全部
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  activeTag === tag
                    ? "border-cat-deep/40 bg-cat-deep/15 text-cat-deep"
                    : "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]"
                )}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 卡片时间轴流 */}
      <div className="flex flex-col gap-3">
        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-subtle-foreground" />
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="glass flex flex-col items-center gap-2 rounded-2xl py-8 text-center">
            <Lightbulb className="size-5 text-candle/50" />
            <p className="text-xs text-subtle-foreground">
              {searchMode ? "没有匹配的灵感。换个关键词或标签试试。" : "这一天还没有灵感记录。捕捉一个转瞬即逝的念头吧。"}
            </p>
          </div>
        )}

        {visible.map((t) => (
          <ThoughtCard
            key={t.id}
            thought={t}
            linkedTask={t.taskId ? tasks.find((task) => task.id === t.taskId) : undefined}
            expanding={expandingId === t.id}
            streamingText={expandingId === t.id ? expandText : ""}
            converting={convertingId === t.id}
            onExpand={() => expandThought(t.id, t.content)}
            onRemove={() => removeThought(t.id)}
            onConvert={() => setPickerThought(t)}
          />
        ))}

        {expandError && (
          <p className="text-center text-[11px] text-cat-blackhole/80">{expandError}</p>
        )}
      </div>

      {/* 象限选择弹窗（Portal 挂载） */}
      <TaskPickerDialog
        open={pickerThought !== null}
        title={pickerThought ? stripTags(pickerThought.content) || pickerThought.content : ""}
        onClose={() => setPickerThought(null)}
        onPick={handlePickQuadrant}
      />
    </section>
  );
}

function ThoughtCard({
  thought,
  linkedTask,
  expanding,
  streamingText,
  converting,
  onExpand,
  onRemove,
  onConvert,
}: {
  thought: Thought;
  linkedTask?: Task;
  expanding: boolean;
  streamingText: string;
  converting: boolean;
  onExpand: () => void;
  onRemove: () => void;
  onConvert: () => void;
}) {
  const time = useMemo(() => {
    try {
      const d = new Date(thought.createdAt);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [thought.createdAt]);

  const linkedMeta = linkedTask ? CATEGORY_META[linkedTask.category] : null;

  return (
    <div className="glass animate-fade-up flex flex-col gap-2.5 rounded-2xl p-4">
      {/* 原文 + 时间 + 操作 */}
      <div className="flex items-start gap-3">
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-candle" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-foreground/90">{thought.content}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {time && (
              <span className="font-mono text-[10px] text-subtle-foreground">{time}</span>
            )}
            {thought.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={onConvert}
            disabled={converting || !!thought.taskId}
            className="gap-1 text-[11px] text-cat-deep hover:bg-cat-deep/10"
            title="转为待办"
          >
            {converting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : thought.taskId ? (
              <CheckCircle2 className="size-3 text-cat-rest" />
            ) : (
              <ListTodo className="size-3" />
            )}
            {thought.taskId ? "已入格" : "转待办"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={onExpand}
            disabled={expanding}
            className="gap-1 text-[11px] text-candle hover:bg-candle/10"
          >
            {expanding ? <Loader2 className="size-3 animate-spin" /> : <WandSparkles className="size-3" />}
            拓展
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={onRemove}
            className="text-[11px] text-subtle-foreground hover:bg-cat-blackhole/10 hover:text-cat-blackhole"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* 已关联任务状态徽标 */}
      {linkedTask && linkedMeta && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
            linkedMeta.border,
            linkedMeta.bg
          )}
        >
          <span className={cn("size-1.5 rounded-full", linkedMeta.dot)} />
          <span className={cn("text-[11px] font-medium", linkedMeta.text)}>
            {linkedMeta.label}
          </span>
          <span className="text-[11px] text-muted-foreground">
            已关联待办 · {taskStatusLabel(linkedTask.status)}
          </span>
        </div>
      )}

      {/* AI 拓展区 */}
      {(expanding || thought.aiExpansion) && (
        <div
          className={cn(
            "rounded-xl border border-candle/15 bg-candle/[0.04] p-3",
            expanding && "glow-candle"
          )}
        >
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-candle/60">
            <WandSparkles className="size-3" />
            AI 拓展
          </p>
          <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
            {expanding ? (
              <>
                {streamingText}
                <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-candle/70 align-middle" />
              </>
            ) : (
              thought.aiExpansion
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function taskStatusLabel(status: Task["status"]): string {
  switch (status) {
    case "done":
      return "已完成";
    case "in-progress":
      return "进行中";
    case "frozen":
      return "已冷冻";
    default:
      return "待办";
  }
}
