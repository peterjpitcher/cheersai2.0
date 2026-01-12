"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updatePlannerContentBody } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";

const EDITABLE_STATUSES = new Set(["draft", "scheduled", "queued", "failed"]);

interface PlannerContentBodyFormProps {
  contentId: string;
  initialBody: string;
  status: string;
  placement: "feed" | "story";
}

export function PlannerContentBodyForm({ contentId, initialBody, status, placement }: PlannerContentBodyFormProps) {
  const isStory = placement === "story";
  const canEdit = !isStory && EDITABLE_STATUSES.has(status);
  const [body, setBody] = useState(initialBody);
  const [baseline, setBaseline] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const isDirty = body.trim() !== baseline.trim();
  const bodyLength = body.length;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || isPending) return;
    const trimmed = body.trim();
    if (!trimmed.length) {
      setError("Write something before saving.");
      return;
    }

    setError(null);
    setFeedback(null);

    startTransition(async () => {
      try {
        await updatePlannerContentBody({ contentId, body: trimmed });
        setBaseline(trimmed);
        setBody(trimmed);
        setFeedback("Post copy saved");
        toast.success("Post copy updated", {
          description: "Your changes have been saved.",
        });
        router.push("/planner");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save changes.";
        setError(message);
        toast.error("Save failed", { description: message });
      }
    });
  };

  const handleReset = () => {
    setBody(baseline);
    setError(null);
    setFeedback(null);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
        Copy
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={10}
          disabled={!canEdit || isPending || isStory}
          placeholder={isStory ? "Stories publish without captions." : undefined}
          className="h-48 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm transition focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{bodyLength.toLocaleString()} characters</span>
        {isStory ? <span>Stories don’t require copy.</span> : !canEdit ? <span>This post can no longer be edited.</span> : null}
      </div>
      {!isStory ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={!isDirty || isPending}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              Reset
            </button>
          </div>
          <button
            type="submit"
            disabled={!canEdit || !isDirty || isPending}
            className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:bg-brand-navy/60"
          >
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : null}
      <div className="min-h-[1.25rem] text-xs text-rose-600">{error ?? ""}</div>
      <div className="min-h-[1.25rem] text-xs text-emerald-600">{feedback ?? ""}</div>
    </form>
  );
}
