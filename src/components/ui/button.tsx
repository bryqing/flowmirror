import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        secondary:
          "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-foreground",
        outline:
          "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        destructive:
          "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        xs: "h-7 rounded-md px-2.5 text-xs",
        lg: "h-11 rounded-xl px-6 text-base",
        icon: "size-9",
        "icon-sm": "size-7 rounded-lg",
        "icon-xs": "size-6 rounded-md",
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
