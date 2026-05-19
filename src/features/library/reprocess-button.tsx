"use client";

import { useState, useTransition } from "react";
import { backfillMediaAspectClass } from "@/app/(app)/library/actions";

export function ReprocessButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ updated: number; failed: number } | null>(null);

  const handleClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await backfillMediaAspectClass();
      setResult(r);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-3 py-1.5 text-[11px] font-medium text-[var(--c-ink-2)] shadow-[var(--sh-sm)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)] disabled:opacity-50"
      >
        {isPending ? "Classifying..." : "Re-classify image shapes"}
      </button>
      {result ? (
        <p className="text-[11px] text-[var(--c-ink-3)]">
          Done -- {result.updated} classified
          {result.failed ? `, ${result.failed} failed` : ""}.
        </p>
      ) : null}
    </div>
  );
}
