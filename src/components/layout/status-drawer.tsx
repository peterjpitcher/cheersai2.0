"use client";

import { type ReactNode, useEffect, useId, useState } from "react";
import { BellRing, X } from "lucide-react";
import { clsx } from "clsx";

interface StatusDrawerProps {
  feed: ReactNode;
}

export function StatusDrawer({ feed }: StatusDrawerProps) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();

  useEffect(() => {
    if (!open) return;

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={drawerId}
        className={clsx(
          "flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
          "border-white/30 bg-white/10 text-white hover:border-white/60 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
        )}
      >
        <BellRing className="h-4 w-4" />
        Live activity
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close activity drawer"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <aside
            id={drawerId}
            className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-brand-mist/60"
          >
            <header className="flex items-start justify-between gap-4 border-b border-brand-mist/60 bg-brand-mist/20 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-teal/70">Realtime feed</p>
                <h2 className="text-lg font-semibold text-brand-teal">Publishing status & alerts</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-brand-mist/60 p-1 text-brand-teal transition hover:border-brand-teal hover:text-brand-caramel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/60"
                aria-label="Close activity drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="space-y-4 text-sm text-brand-teal">
                {feed}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

