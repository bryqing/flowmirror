"use client";

import { Sunrise } from "lucide-react";
import { MORNING_ANCHOR } from "@/lib/mock-data";

/** 晨间唤醒金句：基于昨日反思提炼的一日行动锚点 */
export function MorningAnchor() {
  return (
    <section className="glass animate-fade-up relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-10 -top-14 size-44 rounded-full bg-cat-deep/[0.07] blur-3xl" />
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-cat-deep/20 bg-cat-deep/10">
          <Sunrise className="size-4 text-cat-deep" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-subtle-foreground">
            Morning Anchor · {MORNING_ANCHOR.date}
          </p>
          <h2 className="mt-1.5 text-lg font-light leading-snug tracking-tight sm:text-xl">
            {MORNING_ANCHOR.quote}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {MORNING_ANCHOR.context}
          </p>
        </div>
      </div>
    </section>
  );
}
