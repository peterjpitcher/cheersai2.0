"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { chooseGoogleLocation } from "@/app/(app)/connections/google-actions";
import type { GoogleLocationChooserState } from "@/lib/connections/google-choice-view";

interface LocationChooserProps {
  state: GoogleLocationChooserState;
}

/**
 * What happened to this screen's own submit. It wins over the server state:
 * picking a location uses the choice up, so the server re-render Next.js does
 * after the action would otherwise replace a specific error, or the success,
 * with "already used".
 */
type Outcome = { phase: "idle" } | { phase: "done" } | { phase: "failed"; error: string };

const GENERIC_ERROR = "We could not finish this. Please start again from the Connections screen.";

/**
 * The Google location list and the confirm button. Nothing is ever selected
 * for the owner, even when there is only one location. Receives names,
 * addresses and the random choice reference only; the Google tokens never
 * leave the server.
 */
export function LocationChooser({ state }: LocationChooserProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ phase: "idle" });
  const [isPending, startTransition] = useTransition();

  if (outcome.phase === "failed") {
    // The button that had focus is gone: move focus to the reason.
    return <Refusal message={outcome.error} focusOnMount />;
  }

  if (outcome.phase === "done") {
    return (
      <p role="status" className="text-sm" style={{ color: "var(--c-ink-2)" }}>
        Connected. Taking you back to Connections…
      </p>
    );
  }

  if (state.kind === "unavailable") {
    return <Refusal message={state.message} />;
  }

  const { view } = state;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedId || isPending) return;

    startTransition(async () => {
      try {
        const result = await chooseGoogleLocation({ choice: view.token, locationId: selectedId });
        if (!result?.success) {
          setOutcome({ phase: "failed", error: result?.error ?? GENERIC_ERROR });
          return;
        }
        setOutcome({ phase: "done" });
        const params = new URLSearchParams({ oauth: "success", provider: "gbp" });
        router.replace(`/connections?${params.toString()}`);
      } catch {
        // A thrown server action reaches the browser as technical text: never show it.
        setOutcome({ phase: "failed", error: GENERIC_ERROR });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {view.incomplete ? (
        <p
          role="status"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "var(--c-line)", backgroundColor: "var(--c-orange-tint)", color: "var(--c-ink-2)" }}
        >
          Some of your Google accounts could not be listed, so this list may be incomplete. If your location is missing,
          cancel and connect again in a few minutes.
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
          Your Google locations
        </legend>
        {view.options.map((option, index) => {
          const inputId = `location-${index}`;
          const checked = selectedId === option.id;
          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className="flex cursor-pointer items-start gap-3 rounded-xl border p-4"
              style={{
                borderColor: checked ? "var(--c-ink)" : "var(--c-line)",
                backgroundColor: "var(--c-card)",
              }}
            >
              <input
                id={inputId}
                type="radio"
                name="location"
                value={option.id}
                checked={checked}
                disabled={isPending}
                onChange={() => setSelectedId(option.id)}
                className="mt-1"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="break-words text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
                  {option.title}
                  {option.connectedNow ? (
                    <span className="ml-2 text-xs font-medium" style={{ color: "var(--c-ink-3)" }}>
                      Connected now
                    </span>
                  ) : null}
                </span>
                <span className="break-words text-xs" style={{ color: "var(--c-ink-2)" }}>
                  {option.address ?? "No address on this listing"}
                </span>
                {option.accountName ? (
                  <span className="break-words text-xs" style={{ color: "var(--c-ink-3)" }}>
                    Google account: {option.accountName}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!selectedId || isPending}
          className="rounded-full border px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ borderColor: "var(--c-ink)", backgroundColor: "var(--c-ink)" }}
        >
          {isPending ? "Connecting…" : "Connect this location"}
        </button>
        <Link href="/connections" className="text-sm font-medium underline" style={{ color: "var(--c-ink-2)" }}>
          Cancel
        </Link>
      </div>

      <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
        This list is ready for 10 minutes after you sign in with Google. Nothing is saved until you choose a location.
      </p>
    </form>
  );
}

interface RefusalProps {
  message: string;
  /** After a failed pick: put keyboard and screen reader focus on the reason. */
  focusOnMount?: boolean;
}

function Refusal({ message, focusOnMount = false }: RefusalProps) {
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusOnMount) {
      alertRef.current?.focus();
    }
  }, [focusOnMount]);

  return (
    <div className="space-y-4">
      <div
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className="rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: "var(--c-claret)", backgroundColor: "var(--c-claret-soft)", color: "var(--c-claret)" }}
      >
        {message}
      </div>
      <Link href="/connections" className="text-sm font-medium underline" style={{ color: "var(--c-ink-2)" }}>
        Back to Connections
      </Link>
    </div>
  );
}
