"use client";

import { Activity, Lightbulb, ListTodo, Sparkles, Swords, type LucideIcon } from "lucide-react";
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
 * 顶部横向一级导航。
 *
 * 五个入口横向自适应排列：窄屏（390px）下允许横向滑动，绝不换行挤压；
 * 选中态用晨曦青胶囊高亮。切换由父级控制展示，本组件只负责视觉与点击。
 */
export function SectionNav({
  active,
  onChange,
}: {
  active: SectionId;
  onChange: (id: SectionId) => void;
}) {
  return (
    <nav aria-label="板块导航">
      <div className="glass-strong flex items-center gap-1.5 overflow-x-auto rounded-2xl p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
    </nav>
  );
}
