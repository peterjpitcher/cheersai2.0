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

const DEFAULT_DURATION = 3800;

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
      <style dangerouslySetInnerHTML={{ __html: `@keyframes toast-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}` }} />
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2" style={{ maxWidth: '24rem' }}>
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

          const toneStyle: React.CSSProperties =
            toast.tone === "success"
              ? { background: "var(--c-orange)", color: "#fff" }
              : toast.tone === "error"
                ? { background: "var(--c-claret)", color: "#fff" }
                : { background: "var(--c-ink)", color: "#fff" };

          return (
            <div
            key={toast.id}
            className="pointer-events-auto rounded-2xl px-4 py-3 text-sm shadow-lg"
            style={{
              ...toneStyle,
              animation: "toast-enter var(--m-base) var(--m-ease) both",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="font-semibold">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-1 text-xs opacity-80">{toast.description}</p>
                ) : null}
                {toast.action ? (
                  <button
                    type="button"
                    onClick={handleAction}
                    className="inline-flex items-center justify-center rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/60 hover:bg-white/10"
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
                className="-mr-2 rounded-full px-2 py-1 text-xs font-semibold text-white/70 transition hover:text-white"
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
