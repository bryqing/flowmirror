import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-white/[0.06] text-foreground",
        muted: "border-transparent bg-white/[0.05] text-muted-foreground",
        deep: "border-cat-deep/25 bg-cat-deep/10 text-cat-deep",
        chore: "border-cat-chore/25 bg-cat-chore/10 text-cat-chore",
        blackhole: "border-cat-blackhole/30 bg-cat-blackhole/10 text-cat-blackhole",
        rest: "border-cat-rest/25 bg-cat-rest/10 text-cat-rest",
        candle: "border-candle/30 bg-candle/10 text-candle",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
