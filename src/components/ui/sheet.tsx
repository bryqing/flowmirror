"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 无障碍标题（视觉隐藏时传 srOnly） */
  title?: string;
}

/**
 * 响应式抽屉：移动端为底部 Bottom Sheet，桌面端为右侧 Panel。
 * 自带进出场动画、ESC 关闭、背景滚动锁定。
 *
 * 架构要点：
 * - 通过 createPortal 挂载到 document.body 顶层，脱离任何父级 pointer-events /
 *   transform / 层叠上下文的约束，确保模态抽屉永远浮在应用最上层且可交互。
 * - 遮罩层显式 z-10、面板显式 z-20，杜绝 backdrop-blur 建立的层叠上下文抢占事件。
 * - 面板内部 stopPropagation，避免点击面板冒泡到遮罩触发意外关闭。
 */
export function Sheet({ open, onClose, children, title }: SheetProps) {
  // mounted 用于客户端检测 + 退场动画协调；SSR 阶段始终为 false，不渲染任何内容
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 320);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ESC 关闭 + 背景滚动锁定（仅在打开时）
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

  // 未挂载（含 SSR 阶段）不渲染，避免 SSR 水合报错
  if (!mounted) return null;

  const dialog = (
    <div
      className={cn(
        "fixed inset-0 z-[100]",
        closing ? "sheet-exit" : "sheet-enter"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "抽屉面板"}
    >
      {/* 背景遮罩：显式 z-10 */}
      <div
        className="sheet-backdrop absolute inset-0 z-10 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 移动端：底部弹出，显式 z-20 */}
      <div className="sheet-panel sheet-panel-mobile absolute inset-x-0 bottom-0 z-20 sm:hidden">
        <div
          className="glass-strong max-h-[88vh] overflow-y-auto rounded-t-3xl border-b-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/15" />
          <SheetHeader onClose={onClose} title={title} />
          {children}
        </div>
      </div>

      {/* 桌面端：右侧滑出，显式 z-20 */}
      <div className="sheet-panel sheet-panel-desktop absolute bottom-0 right-0 top-0 z-20 hidden w-full max-w-[520px] sm:block">
        <div
          className="glass-strong flex h-full flex-col overflow-hidden rounded-l-3xl border-r-0"
          onClick={(e) => e.stopPropagation()}
        >
          <SheetHeader onClose={onClose} title={title} />
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );

  // 挂载到 document.body 顶层，脱离 app-shell 的局部容器（如 pointer-events-none）
  return createPortal(dialog, document.body);
}

function SheetHeader({ onClose, title }: { onClose: () => void; title?: string }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      {title ? (
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      ) : (
        <span />
      )}
      <button
        onClick={onClose}
        aria-label="关闭"
        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
