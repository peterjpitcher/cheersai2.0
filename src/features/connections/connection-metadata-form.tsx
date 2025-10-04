"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateConnectionMetadata } from "@/app/(app)/connections/actions";
import { useToast } from "@/components/providers/toast-provider";

type Provider = "facebook" | "instagram" | "gbp";

interface ConnectionMetadataFormProps {
  provider: Provider;
  label: string;
  helper: string;
  placeholder: string;
  defaultValue: string;
  invalid?: boolean;
}

export function ConnectionMetadataForm({ provider, label, helper, placeholder, defaultValue, invalid = false }: ConnectionMetadataFormProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = value.trim();
    const optimisticId = toast.info("Saving metadata…", { durationMs: 1500 });

    startTransition(async () => {
      try {
        const result = await updateConnectionMetadata({ provider, metadataValue: trimmed });
        toast.dismiss(optimisticId);

        if (result?.ok) {
          toast.success("Metadata updated", {
            description: result.value ? `Saved ${label} (${result.value}).` : "Cleared stored metadata.",
          });
        } else {
          toast.error("Could not save metadata", {
            description: "Unexpected response. Please try again.",
          });
        }

        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong";
        toast.dismiss(optimisticId);
        toast.error("Could not save metadata", { description: message });
        setError(message);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <input
          type="text"
          name="metadataValue"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          disabled={isPending}
          aria-invalid={invalid}
          className={`w-full rounded-xl border bg-white p-2 text-sm text-slate-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
            invalid ? "border-rose-300 focus:border-rose-400" : "border-slate-200 focus:border-slate-400"
          }`}
        />
      </label>
      <p className={`text-xs ${invalid ? "text-rose-600" : "text-slate-500"}`}>{helper}</p>
      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => setValue("")}
          disabled={isPending || value.trim().length === 0}
          className="text-xs font-semibold text-slate-500 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      <div aria-live="polite" className="min-h-[1rem] text-xs text-rose-600">
        {error ?? ""}
      </div>
    </form>
  );
}
