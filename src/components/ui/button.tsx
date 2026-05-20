import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Variant + size definitions via cva                                 */
/* ------------------------------------------------------------------ */

const buttonVariants = cva(
  // base styles
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        /* --- new canonical variants --- */
        primary: [
          "text-white border",
          "bg-[var(--c-orange)] border-[var(--c-orange-hi)]",
          "shadow-[var(--sh-inset)]",
          "hover:bg-[var(--c-orange-hi)]",
          "active:bg-[var(--c-orange-lo)]",
        ],
        amber: [
          "text-white border",
          "bg-[var(--c-orange)] border-[var(--c-orange-hi)]",
          "shadow-[var(--sh-inset)]",
          "hover:bg-[var(--c-orange-hi)]",
          "active:bg-[var(--c-orange-lo)]",
        ],
        secondary: [
          "border",
          "bg-[var(--c-card-raised)] text-[var(--c-ink)] border-[var(--c-line-2)]",
          "hover:bg-[var(--c-paper-2)]",
        ],
        ghost: [
          "border border-transparent bg-transparent",
          "text-[var(--c-ink-2)]",
          "hover:bg-[var(--c-paper-2)]",
        ],
        danger: [
          "border",
          "bg-[var(--c-card-raised)] text-[var(--c-claret)] border-[var(--c-line-2)]",
          "hover:bg-[var(--c-claret-soft)]",
        ],
        inkInverse: [
          "border",
          "bg-[var(--c-ink)] text-white border-[var(--c-ink)]",
        ],

        /* --- legacy aliases (map to canonical styles) --- */
        default: [
          "text-white border",
          "bg-[var(--c-orange)] border-[var(--c-orange-hi)]",
          "shadow-[var(--sh-inset)]",
          "hover:bg-[var(--c-orange-hi)]",
          "active:bg-[var(--c-orange-lo)]",
        ],
        destructive: [
          "border",
          "bg-[var(--c-card-raised)] text-[var(--c-claret)] border-[var(--c-line-2)]",
          "hover:bg-[var(--c-claret-soft)]",
        ],
        outline: [
          "border",
          "bg-[var(--c-card-raised)] text-[var(--c-ink)] border-[var(--c-line-2)]",
          "hover:bg-[var(--c-paper-2)]",
        ],
        link: [
          "border border-transparent bg-transparent",
          "text-[var(--c-ink-2)]",
          "hover:bg-[var(--c-paper-2)]",
        ],
        gloss: [
          "text-white border",
          "bg-[var(--c-orange)] border-[var(--c-orange-hi)]",
          "shadow-[var(--sh-inset)]",
          "hover:bg-[var(--c-orange-hi)]",
          "active:bg-[var(--c-orange-lo)]",
        ],
      },
      size: {
        sm: "h-[26px] px-[10px] text-[12px] rounded-[5px]",
        md: "h-[32px] px-[12px] text-[13px] rounded-[var(--r-md,6px)]",
        lg: "h-[40px] px-[18px] text-[14px] rounded-[var(--r-lg,8px)]",
        /* legacy aliases */
        default: "h-[32px] px-[12px] text-[13px] rounded-[var(--r-md,6px)]",
        icon: "h-[32px] w-[32px] p-0 rounded-[var(--r-md,6px)] justify-center",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  variant?:
    | "primary"
    | "amber"
    | "secondary"
    | "ghost"
    | "danger"
    | "inkInverse"
    | "default"
    | "destructive"
    | "outline"
    | "link"
    | "gloss";
  size?: "sm" | "md" | "lg" | "default" | "icon";
  icon?: React.ComponentType<{ className?: string }>;
  iconRight?: React.ComponentType<{ className?: string }>;
  full?: boolean;
  asChild?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      asChild = false,
      icon: Icon,
      iconRight: IconRight,
      full,
      children,
      ...props
    },
    ref
  ) => {
    const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
    const classes = cn(
      buttonVariants({ variant, size }),
      full && "w-full",
      className
    );

    if (asChild) {
      return (
        <Slot className={classes} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button className={classes} ref={ref} {...props}>
        {Icon && <Icon className={cn(iconSize, "shrink-0")} />}
        {children}
        {IconRight && <IconRight className={cn(iconSize, "shrink-0")} />}
      </button>
    );
  }
);
Button.displayName = "Button";

/* Alias for new code */
const Btn = Button;

export { Button, Btn, buttonVariants };
