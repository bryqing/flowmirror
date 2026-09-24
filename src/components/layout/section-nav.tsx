"use client";

import {
  Activity,
  Lightbulb,
  ListTodo,
  RefreshCw,
  Sparkles,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { cn } from "@/lib/utils";

/** 五大板块一级入口（顺序即展示顺序，默认进入「今日战局」） */
export type SectionId = "mirror" | "battle" | "backlog" | "timeline" | "thoughts";

export const SECTION_TABS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "mirror", label: "昨日之镜", icon: Sparkles },
  { id: "battle", label: "今日战局", icon: Swords },
  { id: "backlog", label: "待执行清单", icon: ListTodo },
  { id: "timeline", label: "今日时间分布", icon: Activity },
  { id: "thoughts", label: "灵感与思考", icon: Lightbulb },
];

/**
 * 顶部横向一级导航 + **常驻的「立即同步」入口**。
 *
 * 五个入口横向自适应排列：窄屏（390px）下允许横向滑动，绝不换行挤压；
 * 选中态用晨曦青胶囊高亮。切换由父级控制展示，本组件只负责视觉与点击。
 *
 * 右侧的刷新按钮刻意放在**滚动区之外**：胶囊条横向滚动时它必须始终可见，
 * 否则手机上"往右滑才能找到同步按钮"等于没有。它是用户手上唯一的
 * 「我现在就要云端最新数据」的强制手段 —— 自动通道（Realtime / 轮询 /
 * 切回前台）任何一个环节失灵，都还有这里可以自证与自救。
 */
export function SectionNav({
  active,
  onChange,
}: {
  active: SectionId;
  onChange: (id: SectionId) => void;
}) {
  const { syncNow, syncing, synced } = useFlow();

  return (
    <nav aria-label="板块导航">
      <div className="glass-strong flex items-center rounded-2xl p-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTION_TABS.map(({ id, label, icon: Icon }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                aria-current={isActive ? "page" : undefined}
                data-section-tab={id}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-all duration-200",
                  "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <Icon className={cn("size-4", isActive ? "text-white" : "text-slate-400")} />
                {label}
              </button>
            );
          })}
        </div>

        <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-slate-200" />

        <button
          type="button"
          data-sync-refresh
          onClick={() => void syncNow()}
          disabled={syncing}
          aria-label="立即同步云端最新数据"
          aria-busy={syncing}
          title={synced ? "立即同步 · 拉取云端最新数据" : "立即同步（未登录时仅提示）"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "active:scale-95 disabled:cursor-not-allowed disabled:opacity-60",
            synced
              ? "text-cat-rest hover:bg-cat-rest/10"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          )}
        >
          <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
        </button>
      </div>
    </nav>
  );
}
