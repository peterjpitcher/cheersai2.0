"use client";

import type { CSSProperties } from "react";
import { useFormStatus } from "react-dom";

export function SignOutButton() {
  const { pending } = useFormStatus();
  const baseStyle: CSSProperties = {
    borderColor: "var(--c-ink)",
    backgroundColor: "var(--c-ink)",
  };
  const baseClass = "inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <button type="submit" className={baseClass} style={baseStyle} disabled={pending}>
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
