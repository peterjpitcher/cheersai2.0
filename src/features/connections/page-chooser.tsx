"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { choosePageForConnection } from "@/app/(app)/connections/page-choice-actions";
import { ChangePageButton } from "@/features/connections/change-page-button";
import type { PageChoiceView, PageChooserState } from "@/lib/connections/page-choice-view";

interface PageChooserProps {
  state: PageChooserState;
}

type Provider = PageChoiceView["provider"];

/**
 * What happened to this screen's own submit. It wins over the server state:
 * picking a Page uses the choice up, so the server re-render Next.js does
 * after the action (for example when the session cookie is refreshed) would
 * otherwise replace a specific error, or the success, with "already used".
 */
type Outcome =
  | { phase: "idle" }
  | { phase: "done" }
  | { phase: "failed"; error: string; provider: Provider; changePage: boolean };

const GENERIC_ERROR = "We could not finish this. Please start again.";

/**
 * The Page list and the confirm button. Receives only names, flags and the
 * random choice reference; the tokens never leave the server.
 */
export function PageChooser({ state }: PageChooserProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ phase: "idle" });
  const [isPending, startTransition] = useTransition();

  if (outcome.phase === "failed") {
    // The button that had focus is gone: move focus to the reason.
    return (
      <Refusal
        message={outcome.error}
        provider={outcome.provider}
        changePage={outcome.changePage}
        canStartAgain
        focusOnMount
      />
    );
  }

  if (outcome.phase === "done") {
    return (
      <p role="status" className="text-sm" style={{ color: "var(--c-ink-2)" }}>
        Connected. Taking you back to Connections…
      </p>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Refusal
        message={state.message}
        provider={state.provider}
        changePage={state.changePage}
        canStartAgain={state.canStartAgain}
      />
    );
  }

  const { view } = state;
  const selectable = view.options.filter((option) => option.selectable);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedId || isPending) return;

    startTransition(async () => {
      const fail = (error: string) =>
        setOutcome({ phase: "failed", error, provider: view.provider, changePage: view.changePage });
      try {
        const result = await choosePageForConnection({ choice: view.token, pageId: selectedId });
        if (!result?.success) {
          fail(result?.error ?? GENERIC_ERROR);
          return;
        }
        setOutcome({ phase: "done" });
        const params = new URLSearchParams({ oauth: "success", provider: view.provider });
        if (result.notice) params.set("message", result.notice);
        router.replace(`/connections?${params.toString()}`);
      } catch {
        fail(GENERIC_ERROR);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {view.instagramConnected ? (
        <p
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "var(--c-line)", backgroundColor: "var(--c-orange-tint)", color: "var(--c-ink-2)" }}
        >
          Instagram uses the same Page as Facebook. If you choose a different Page, Instagram moves to that Page&apos;s
          account, or is disconnected if the Page has none.
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
          Your Facebook Pages
        </legend>
        {view.options.map((option) => {
          const inputId = `page-${option.id}`;
          const checked = selectedId === option.id;
          // Only the radio and the name are dimmed on a Page that cannot be
          // picked; the reason and the Instagram line keep full contrast.
          const dimmed = option.selectable ? "" : "opacity-70";
          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={`flex items-start gap-3 rounded-xl border p-4 ${option.selectable ? "cursor-pointer" : "cursor-not-allowed"}`}
              style={{
                borderColor: checked ? "var(--c-ink)" : "var(--c-line)",
                backgroundColor: "var(--c-card)",
              }}
            >
              <input
                id={inputId}
                type="radio"
                name="page"
                value={option.id}
                checked={checked}
                disabled={!option.selectable || isPending}
                onChange={() => setSelectedId(option.id)}
                className={`mt-1 ${dimmed}`}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="break-words text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
                  <span className={dimmed}>{option.name}</span>
                  {option.connectedNow ? (
                    <span className="ml-2 text-xs font-medium" style={{ color: "var(--c-ink-3)" }}>
                      Connected now
                    </span>
                  ) : null}
                </span>
                <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                  {option.hasInstagram
                    ? `Instagram: ${option.instagramUsername ? `@${option.instagramUsername}` : "linked"}`
                    : "No Instagram account linked"}
                </span>
                {option.note ? (
                  <span className="text-xs" style={{ color: "var(--c-claret)" }}>
                    {option.note}
                  </span>
                ) : null}
                {option.instagramEffect ? (
                  <span className="text-xs" style={{ color: "var(--c-ink-2)" }}>
                    {option.instagramEffect}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>

      {view.options.length === 1 ? (
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          Facebook shared only one Page with CheersAI. To choose another, check that your Facebook profile manages it and
          that you gave CheersAI access to it when Facebook asked, then start again.
        </p>
      ) : null}

      {selectable.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--c-claret)" }}>
          None of these Pages can be connected. Check your role on the Page you want, then start again.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!selectedId || isPending}
          className="rounded-full border px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ borderColor: "var(--c-ink)", backgroundColor: "var(--c-ink)" }}
        >
          {isPending ? "Connecting…" : "Connect this Page"}
        </button>
        <Link href="/connections" className="text-sm font-medium underline" style={{ color: "var(--c-ink-2)" }}>
          Cancel
        </Link>
      </div>

      <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
        This list is ready for 10 minutes after you log in with Facebook. Not seeing your Page? Check that your Facebook
        profile manages it, then start again.
      </p>
      {selectable.length === 0 || view.options.length === 1 ? (
        <ChangePageButton provider={view.provider} changePage={view.changePage} label="Start again" />
      ) : null}
    </form>
  );
}

interface RefusalProps {
  message: string;
  provider: Provider | null;
  changePage: boolean;
  canStartAgain: boolean;
  /** After a failed pick: put keyboard and screen reader focus on the reason. */
  focusOnMount?: boolean;
}

function Refusal({ message, provider, changePage, canStartAgain, focusOnMount = false }: RefusalProps) {
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
      <div className="flex flex-wrap items-center gap-3">
        {canStartAgain && provider ? (
          <ChangePageButton provider={provider} changePage={changePage} label="Start again" />
        ) : null}
        <Link href="/connections" className="text-sm font-medium underline" style={{ color: "var(--c-ink-2)" }}>
          Back to Connections
        </Link>
      </div>
    </div>
  );
}
