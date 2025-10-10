"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastTone = "success" | "error" | "info";

interface ToastRecord {
  id: string;
  title: string;
  tone: ToastTone;
  description?: string;
  action?: ToastAction;
}

interface ToastOptions {
  tone?: ToastTone;
  description?: string;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastContextValue {
  push: (title: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  success: (title: string, options?: Omit<ToastOptions, "tone">) => string;
  error: (title: string, options?: Omit<ToastOptions, "tone">) => string;
  info: (title: string, options?: Omit<ToastOptions, "tone">) => string;
}

const DEFAULT_DURATION = 4000;

interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      globalThis.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const scheduleRemoval = useCallback(
    (id: string, duration: number) => {
      const timeoutId = globalThis.setTimeout(() => {
        timers.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, duration);
      timers.current.set(id, timeoutId);
    },
    [],
  );

  const push = useCallback(
    (title: string, options?: ToastOptions) => {
      const id = generateId();
      const tone: ToastTone = options?.tone ?? "info";
      const description = options?.description;
      setToasts((current) => [...current, { id, title, tone, description, action: options?.action }]);
      scheduleRemoval(id, options?.durationMs ?? DEFAULT_DURATION);
      return id;
    },
    [scheduleRemoval],
  );

  const success = useCallback((title: string, options?: Omit<ToastOptions, "tone">) => push(title, { ...options, tone: "success" }), [push]);
  const error = useCallback((title: string, options?: Omit<ToastOptions, "tone">) => push(title, { ...options, tone: "error" }), [push]);
  const info = useCallback((title: string, options?: Omit<ToastOptions, "tone">) => push(title, { ...options, tone: "info" }), [push]);

  const value = useMemo<ToastContextValue>(
    () => ({ push, dismiss, success, error, info }),
    [push, dismiss, success, error, info],
  );

  useEffect(() => {
    const timersMap = timers.current;
    return () => {
      timersMap.forEach((timer) => globalThis.clearTimeout(timer));
      timersMap.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex max-w-xs flex-col gap-2">
        {toasts.map((toast) => {
          const handleAction = () => {
            if (!toast.action) return;
            try {
              const result = toast.action.onClick();
              if (result && typeof (result as Promise<unknown>).then === "function") {
                (result as Promise<unknown>)
                  .catch((error) => {
                    console.error("[toast] action failed", error);
                  })
                  .finally(() => dismiss(toast.id));
              } else {
                dismiss(toast.id);
              }
            } catch (error) {
              console.error("[toast] action failed", error);
              dismiss(toast.id);
            }
          };

          return (
            <div
            key={toast.id}
            className={[
              "pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg",
              toast.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
              toast.tone === "error" && "border-rose-200 bg-rose-50 text-rose-900",
              toast.tone === "info" && "border-slate-200 bg-white text-slate-900",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="font-semibold">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-1 text-xs text-slate-600">{toast.description}</p>
                ) : null}
                {toast.action ? (
                  <button
                    type="button"
                    onClick={handleAction}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-brand-teal transition hover:border-brand-teal hover:text-brand-teal"
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
                className="-mr-2 rounded-full px-2 py-1 text-xs font-semibold text-slate-500 transition hover:text-slate-900"
              >
                ×
              </button>
            </div>
          </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
