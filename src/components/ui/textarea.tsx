import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-[72px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm leading-relaxed text-foreground",
        "placeholder:text-subtle-foreground outline-none transition-all duration-200 resize-none",
        "focus:border-cat-deep/40 focus:bg-white/[0.06] focus:ring-2 focus:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
