import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-foreground",
        "placeholder:text-subtle-foreground outline-none transition-all duration-200",
        "focus:border-cat-deep/40 focus:bg-white/[0.06] focus:ring-2 focus:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
