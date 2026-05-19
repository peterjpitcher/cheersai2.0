import * as React from "react";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}

function Field({ label, hint, error, children, className, htmlFor }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-[6px]", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[13px] font-medium text-[var(--c-ink)]"
        >
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[12px] text-[var(--c-claret)]">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-[var(--c-ink-3)]">{hint}</p>
      ) : null}
    </div>
  );
}

export { Field };
