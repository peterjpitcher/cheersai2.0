import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[var(--btn-icon-gap)] whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // Default = standard form buttons (h-10)
        default: "h-10 px-[var(--btn-px-md)] py-[var(--btn-py-md)]",
        md: "h-10 px-[var(--btn-px-md)] py-[var(--btn-py-md)]",
        // Small = compact header/filters (h-9)
        sm: "h-9 rounded-md px-[var(--btn-px-sm)] py-[var(--btn-py-sm)]",
        // Large = prominent CTAs
        lg: "h-11 rounded-md px-[var(--btn-px-lg)] py-[var(--btn-py-lg)]",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  iconPlacement?: "left" | "right"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, iconPlacement = "left", children, disabled, ...props }, ref) => {
    const Comp = asChild ? "span" : "button"
    const content = (
      <>
        {loading && iconPlacement === "left" && (
          <Loader2 aria-hidden className="size-4 animate-spin align-middle" />
        )}
        {children}
        {loading && iconPlacement === "right" && (
          <Loader2 aria-hidden className="size-4 animate-spin align-middle" />
        )}
        {loading && (
          <span className="sr-only" aria-live="polite">Loading</span>
        )}
      </>
    )
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          iconPlacement === "right" && "flex-row-reverse"
        )}
        ref={ref}
        aria-busy={loading || undefined}
        disabled={loading || disabled}
        {...props}
      >
        {content}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
