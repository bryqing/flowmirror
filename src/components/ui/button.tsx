import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_4px_20px_-6px_rgba(255,255,255,0.25)] hover:bg-white/90",
        secondary:
          "bg-white/[0.06] text-foreground border border-white/10 hover:bg-white/[0.1]",
        ghost: "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
        outline:
          "border border-white/12 bg-transparent text-foreground hover:bg-white/[0.05]",
        destructive:
          "bg-cat-blackhole/15 text-cat-blackhole border border-cat-blackhole/30 hover:bg-cat-blackhole/25",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        xs: "h-7 rounded-md px-2.5 text-xs",
        lg: "h-11 rounded-xl px-6 text-base",
        icon: "size-9",
        "icon-sm": "size-7 rounded-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
