"use client";

import { useEffect, useState, type ReactNode } from "react";
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
 */
export function Sheet({ open, onClose, children, title }: SheetProps) {
  const [mounted, setMounted] = useState(open);
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

  return (
    <div
      className={cn(
        "fixed inset-0 z-50",
        closing ? "sheet-exit" : "sheet-enter"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "抽屉面板"}
    >
      {/* 背景遮罩 */}
      <div
        className="sheet-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 移动端：底部弹出 */}
      <div className="sheet-panel sheet-panel-mobile absolute inset-x-0 bottom-0 sm:hidden">
        <div className="glass-strong max-h-[88vh] overflow-y-auto rounded-t-3xl border-b-0">
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/15" />
          <SheetHeader onClose={onClose} title={title} />
          {children}
        </div>
      </div>

      {/* 桌面端：右侧滑出 */}
      <div className="sheet-panel sheet-panel-desktop absolute bottom-0 right-0 top-0 hidden w-full max-w-[520px] sm:block">
        <div className="glass-strong flex h-full flex-col overflow-hidden rounded-l-3xl border-r-0">
          <SheetHeader onClose={onClose} title={title} />
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
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
