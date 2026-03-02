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
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
      >
        {isPending ? "Classifying…" : "Re-classify image shapes"}
      </button>
      {result ? (
        <p className="text-xs text-slate-500">
          Done — {result.updated} classified
          {result.failed ? `, ${result.failed} failed` : ""}.
        </p>
      ) : null}
    </div>
  );
}
