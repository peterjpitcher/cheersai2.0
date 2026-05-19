'use client';

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}

const segmentHeights: Record<string, string> = {
  sm: "h-[22px]",
  md: "h-[26px]",
};

function Segmented({
  options,
  value,
  onChange,
  size = 'md',
  className,
}: SegmentedProps) {
  return (
    <div
      className={cn(
        "inline-flex rounded-md border border-[var(--c-line)] bg-[var(--c-paper-2)] p-[2px]",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange?.(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[4px] px-[10px] text-[12px] transition-all [transition-duration:var(--m-fast)] [transition-timing-function:var(--m-ease)]",
              segmentHeights[size],
              isActive
                ? "bg-[var(--c-card-raised)] shadow-[var(--sh-xs)] border border-[var(--c-line-2)] text-[var(--c-ink)] font-medium"
                : "bg-transparent border border-transparent text-[var(--c-ink-3)]",
            )}
          >
            {Icon && <Icon className="size-[13px] shrink-0" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
