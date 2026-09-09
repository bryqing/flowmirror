"use client";

import { useEffect, useState } from "react";
import { Brain, CheckCircle2, MessageSquareText } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useFlow } from "@/components/flow-context";
import { CATEGORY_META } from "@/lib/types";
import { cn } from "@/lib/utils";

const BLOCKER_TAGS = ["开场焦虑", "被打断", "工具不熟", "估时乐观", "环境嘈杂", "没有卡点"];
const LESSON_TAGS = ["先搭框架", "关通知", "拆小步", "烂初稿先行", "番茄25分", "环境隔离"];

const BLACKHOLE_BLOCKER_TAGS = ["无意识点开", "情绪逃避", "太累想放松", "超时失控", "本就计划内"];
const BLACKHOLE_LESSON_TAGS = ["设倒计时", "手机放远", "换种休息", "计划内娱乐", "到点就起身"];

export function ReviewDrawer() {
  const { reviewTask, closeReview, submitReview } = useFlow();
  const open = !!reviewTask;

  const [blockerTags, setBlockerTags] = useState<string[]>([]);
  const [lessonTags, setLessonTags] = useState<string[]>([]);
  const [note, setNote] = useState("");

  /* 每次打开新任务时重置 */
  useEffect(() => {
    if (open) {
      setBlockerTags([]);
      setLessonTags([]);
      setNote("");
    }
  }, [open, reviewTask?.id]);

  if (!reviewTask) {
    return <Sheet open={false} onClose={closeReview} title="微复盘"><div /></Sheet>;
  }

  const isBlackhole = reviewTask.category === "blackhole";
  const meta = CATEGORY_META[reviewTask.category];
  const blockers = isBlackhole ? BLACKHOLE_BLOCKER_TAGS : BLOCKER_TAGS;
  const lessons = isBlackhole ? BLACKHOLE_LESSON_TAGS : LESSON_TAGS;

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) => {
    set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]);
  };

  return (
    <Sheet open={open} onClose={closeReview} title="微复盘 · 做完即追问">
      <div className="flex flex-col gap-5 px-5 pb-8 pt-1">
        {/* 任务上下文 */}
        <div className="flex items-center gap-2.5">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl border", meta.bg, meta.border)}>
            <Brain className={cn("size-4", meta.text)} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{reviewTask.title}</p>
            <p className="text-[11px] text-subtle-foreground">
              {isBlackhole ? "黑洞刹车 —— 不自责，只看清" : "10 秒微复盘，经验当场入库"}
            </p>
          </div>
        </div>

        {/* 问句 1：卡点 */}
        <Question
          index="Q1"
          text={isBlackhole ? "这段黑洞，是怎么不知不觉开始的？" : "刚才最大的卡点是什么？"}
        />
        <TagCloud
          tags={blockers}
          selected={blockerTags}
          onToggle={(t) => toggle(blockerTags, setBlockerTags, t)}
          tone="danger"
        />

        {/* 问句 2：经验 */}
        <Question
          index="Q2"
          text={isBlackhole ? "下次想刷的瞬间，用什么动作替代？" : "下次做同类事，哪一条经验最管用？"}
        />
        <TagCloud
          tags={lessons}
          selected={lessonTags}
          onToggle={(t) => toggle(lessonTags, setLessonTags, t)}
          tone="rest"
        />

        {/* 自由记录 */}
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquareText className="size-3.5" />
            一句话记下此刻的想法（可选）
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isBlackhole ? "例：其实不是想刷，是不想面对那封难写的邮件……" : "例：先写结论果然快多了，下次继续"}
            rows={3}
          />
        </div>

        {/* 操作 */}
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="sm" onClick={closeReview} className="text-subtle-foreground">
            先跳过
          </Button>
          <Button
            className="flex-1 gap-1.5"
            onClick={() =>
              submitReview(reviewTask.id, { blockerTags, lessonTags, note })
            }
          >
            <CheckCircle2 className="size-4" />
            入库，继续下一件
          </Button>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-subtle-foreground">
          每条微复盘都会在深夜深潜中被串联成心智资产，<br className="sm:hidden" />
          并在明早变成你的行动锚点。
        </p>
      </div>
    </Sheet>
  );
}

function Question({ index, text }: { index: string; text: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-cat-deep">
        {index}
      </span>
      <p className="text-sm font-medium leading-snug">{text}</p>
    </div>
  );
}

function TagCloud({
  tags,
  selected,
  onToggle,
  tone,
}: {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  tone: "danger" | "rest";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button key={tag} onClick={() => onToggle(tag)}>
            <Badge
              variant="muted"
              className={cn(
                "cursor-pointer border px-2.5 py-1 text-xs transition-all duration-200",
                !active && "hover:border-white/20 hover:text-foreground",
                active && tone === "danger" && "border-cat-blackhole/40 bg-cat-blackhole/15 text-cat-blackhole",
                active && tone === "rest" && "border-cat-rest/40 bg-cat-rest/15 text-cat-rest"
              )}
            >
              {tag}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
