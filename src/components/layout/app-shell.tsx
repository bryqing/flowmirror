"use client";

import type { ReactNode } from "react";
import { Flame } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { SyncStatus } from "@/components/sync/sync-status";
import { cn } from "@/lib/utils";

/** 应用外壳：氛围背景 + 深夜烛光模式自动切换 + PWA 全屏安全区适配 */
export function AppShell({ children }: { children: ReactNode }) {
  const { candleMode } = useFlow();

  return (
    <div
      className={cn(
        // PWA 全屏无边框（standalone / fullscreen）下，避开刘海/小白条
        // 非 PWA 环境下 env() 返回 0，无副作用
        "relative min-h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        candleMode && "candle-mode"
      )}
    >
      <div className="atmosphere" />

      {candleMode && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 5rem)" }}
        >
          <p className="glass flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] text-candle">
            <Flame className="size-3 animate-breathe" />
            深夜烛光模式 · 低刺激 · 适合认知深潜
          </p>
        </div>
      )}

      {/* 多端同步状态（固定右上角，非侵入式） */}
      <div
        className="pointer-events-none fixed right-4 z-50 flex items-center"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <SyncStatus />
      </div>

      {children}
    </div>
  );
}
