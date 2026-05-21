"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Save } from "lucide-react";

import {
  updateAdAccountConversionSettings,
  type AdAccountSetupStatus,
} from "@/app/(app)/connections/actions-ads";
import { Btn } from "@/components/ui/button";
import { useToast } from "@/components/providers/toast-provider";

interface MetaConversionSetupProps {
  status: AdAccountSetupStatus;
  compact?: boolean;
}

export function MetaConversionSetup({ status, compact = false }: MetaConversionSetupProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [pixelId, setPixelId] = useState(status.metaPixelId ?? "");

  if (!status.setupComplete) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      const result = await updateAdAccountConversionSettings({ metaPixelId: pixelId });
      if (result.error) {
        toast.error("Conversion setup not saved", { description: result.error });
        return;
      }

      toast.success("Conversion setup saved");
      window.location.reload();
    });
  };

  const ready = status.conversionReady;
  const borderColor = ready ? "var(--c-status-posted-bg)" : "var(--c-orange)";
  const backgroundColor = ready ? "var(--c-status-posted-bg)" : "var(--c-orange-soft)";
  const iconColor = ready ? "var(--c-status-posted-fg)" : "var(--c-orange-hi)";

  return (
    <section
      className={compact ? "p-4" : "p-4 md:p-5"}
      style={{
        borderRadius: "var(--r-lg)",
        border: `1px solid ${borderColor}`,
        backgroundColor: "var(--c-card)",
      }}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        <div className="flex min-w-0 gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center"
            style={{
              borderRadius: "var(--r-md)",
              backgroundColor,
              color: iconColor,
            }}
          >
            {ready ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase" style={{ color: "var(--c-ink-3)" }}>
              Booking optimisation
            </p>
            <h2 className="mt-1 text-base font-semibold" style={{ color: "var(--c-ink)" }}>
              {ready ? "Meta Purchase tracking is ready" : "Meta Purchase tracking needs setup"}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--c-ink-3)" }}>
              {ready
                ? `Using pixel ${status.metaPixelId} and Purchase optimisation for booking campaigns.`
                : "Booking campaigns will stay blocked until the venue pixel is configured."}
            </p>
            {!ready && status.conversionIssues.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--c-orange-hi)" }}>
                {status.conversionIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-1">
          <label className="min-w-0 text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
            Meta pixel ID
            <input
              value={pixelId}
              onChange={(event) => setPixelId(event.target.value)}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="123456789012345"
              className="mt-2 w-full rounded-md border border-[var(--c-line)] bg-[var(--c-paper)] px-3 py-2 text-sm focus:outline-none"
              style={{ color: "var(--c-ink)" }}
            />
          </label>
          <div className="flex items-end gap-2">
            <div className="hidden min-w-0 flex-1 sm:block lg:block">
              <p className="text-xs font-medium" style={{ color: "var(--c-ink-3)" }}>
                Event: Purchase
              </p>
            </div>
            <Btn type="submit" disabled={isPending} icon={Save}>
              {isPending ? "Saving" : "Save"}
            </Btn>
          </div>
        </form>
      </div>
    </section>
  );
}
