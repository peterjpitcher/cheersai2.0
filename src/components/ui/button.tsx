import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "ghost" | "link" | "gloss";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const variants = {
      default:
        "bg-primary text-primary-foreground shadow-[0_1px_3px_0_rgb(29_78_216/0.35),0_1px_2px_-1px_rgb(29_78_216/0.25),inset_0_1px_0_0_rgb(255_255_255/0.12)] hover:bg-primary/92 active:scale-[0.98] active:shadow-none transition-all duration-150",
      destructive:
        "bg-destructive text-destructive-foreground shadow-[0_1px_3px_0_rgb(220_38_38/0.35)] hover:bg-destructive/92 active:scale-[0.98] transition-all duration-150",
      outline:
        "border border-border bg-card text-foreground shadow-[0_1px_2px_0_rgb(0_0_0/0.06)] hover:bg-muted hover:border-border/80 active:scale-[0.98] transition-all duration-150",
      ghost:
        "text-foreground hover:bg-muted hover:text-foreground active:scale-[0.98] transition-all duration-150",
      link: "text-primary underline-offset-4 hover:underline transition-colors duration-150",
      gloss:
        "glass-button text-white shadow-md hover:shadow-lg hover:-translate-y-px active:translate-y-0 active:shadow-sm font-semibold tracking-wide transition-all duration-150",
    };

    const sizes = {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-10 rounded-md px-6 text-sm font-semibold",
      icon: "h-9 w-9",
    };

    const baseStyles =
      "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 select-none";

    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(
          baseStyles,
          variants[variant as keyof typeof variants],
          sizes[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
