'use client';

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToggleChipProps {
  active?: boolean;
  onClick?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  tone?: 'fb' | 'ig' | 'orange';
  count?: number;
  className?: string;
}

const toneActiveStyles: Record<string, string> = {
  fb: "bg-[var(--c-fb-bg)] text-[var(--c-fb)] border-[var(--c-fb)]",
  ig: "bg-[var(--c-ig-bg)] text-[var(--c-ig)] border-[var(--c-ig)]",
  orange: "border-[var(--c-orange)] text-[var(--c-orange)]",
};

function ToggleChip({
  active = false,
  onClick,
  icon: Icon,
  children,
  tone,
  count,
  className,
}: ToggleChipProps) {
  const activeClass = tone
    ? toneActiveStyles[tone]
    : "border-[var(--c-orange)] text-[var(--c-orange)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-[30px] rounded-[5px] px-[10px] text-[12px] font-medium border transition-all [transition-duration:var(--m-fast)] [transition-timing-function:var(--m-ease)]",
        active
          ? activeClass
          : "bg-[var(--c-card-raised)] text-[var(--c-ink-2)] border-[var(--c-line-2)]",
        className,
      )}
    >
      {Icon && <Icon className="size-[13px] shrink-0" />}
      <span>{children}</span>
      {count !== undefined && (
        <span className="text-[10px] font-mono text-[var(--c-ink-3)]">
          {count}
        </span>
      )}
    </button>
  );
}

export { ToggleChip };
