import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "destructive" | "muted" | "info" | "outline";
}

const variantClasses: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default:
    "bg-[var(--c-orange-tint)] text-[var(--c-orange)] border-[var(--c-orange-soft)]",
  success:
    "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning:
    "bg-amber-50 text-amber-700 border-amber-200",
  destructive:
    "bg-red-50 text-red-700 border-red-200",
  muted:
    "bg-[var(--c-paper-2)] text-[var(--c-ink-3)] border-[var(--c-line)]",
  info:
    "bg-blue-50 text-blue-700 border-blue-200",
  outline:
    "bg-transparent text-[var(--c-ink)] border-[var(--c-line)]",
};

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
);
Badge.displayName = "Badge";

export { Badge };
