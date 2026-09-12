"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight } from "lucide-react";
import { CATEGORY_META, QUADRANT_META, QUADRANT_ORDER, type TaskCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 四象限顺序（编号与文案统一取自 QUADRANT_META，勿在此重复维护名称） */
const QUADRANTS = QUADRANT_ORDER.map((q) => ({
  key: QUADRANT_META[q].category,
  number: q.toUpperCase(),
  label: QUADRANT_META[q].label,
  hint: QUADRANT_META[q].hint,
}));

interface TaskPickerDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** 用户选中某个象限后回调 */
  onPick: (category: TaskCategory) => void;
}

/**
 * 灵感转待办 · 象限选择弹窗
 * 通过 createPortal 挂载到 document.body 顶层，脱离局部容器约束（同 Sheet 架构约定）。
 */
export function TaskPickerDialog({ open, title, onClose, onPick }: TaskPickerDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const dialog = (
    <div
      className={cn("fixed inset-0 z-[100]", closing ? "sheet-exit" : "sheet-enter")}
      role="dialog"
      aria-modal="true"
      aria-label="转为待办"
    >
      {/* 遮罩 */}
      <div
        className="sheet-backdrop absolute inset-0 z-10 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 居中气泡卡片 */}
      <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
        <div
          className="glass-strong w-full max-w-sm rounded-2xl p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-candle/70">转为待办</p>
              <h3 className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-foreground">
                {title}
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <p className="mb-3 text-[11px] text-subtle-foreground">放入哪个象限？</p>

          <div className="flex flex-col gap-1.5">
            {QUADRANTS.map((q) => {
              const meta = CATEGORY_META[q.key];
              return (
                <button
                  key={q.key}
                  onClick={() => onPick(q.key)}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
                    "hover:bg-white/[0.05]",
                    meta.border,
                    meta.bg
                  )}
                >
                  <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-medium", meta.text)}>
                      <span className="mr-1.5 font-mono text-[10px] opacity-70">{q.number}</span>
                      {q.label}
                    </p>
                    <p className="text-[11px] text-subtle-foreground">{q.hint}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
