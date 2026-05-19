import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex w-full rounded-md border border-input bg-card px-3 py-[14px] text-sm leading-[1.5] resize-y placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-[var(--c-orange)] focus-visible:shadow-[0_0_0_3px_var(--c-orange-soft)] disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
