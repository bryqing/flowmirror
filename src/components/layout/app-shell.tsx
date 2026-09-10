"use client";

import { useEffect, type ReactNode } from "react";
import { Flame } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { SyncStatus } from "@/components/sync/sync-status";
import { DeepDivePanel } from "@/components/sync/deep-dive-panel";
import { cn } from "@/lib/utils";

/** 应用外壳：氛围背景 + 深夜烛光模式自动切换 + PWA 全屏安全区适配 */
export function AppShell({ children }: { children: ReactNode }) {
  const { candleMode } = useFlow();

  // 解除 layout.tsx 中的启动看门狗：能跑到这里说明 React 已成功接管，
  // 不会再出现「页面可见但点不动」的僵尸态。
  useEffect(() => {
    (window as unknown as { __fmAppMounted?: boolean }).__fmAppMounted = true;
  }, []);

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
        className="fixed right-4 z-50 flex items-center"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <SyncStatus />
      </div>

      {/* 深夜深潜入口（固定左上角，开发模式常驻 / 生产环境烛光模式显示） */}
      <div
        className="fixed left-4 z-50 flex items-center"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <DeepDivePanel />
      </div>

      {children}
    </div>
  );
}
