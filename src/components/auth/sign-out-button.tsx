"use client";

import { useFormStatus } from "react-dom";

export function SignOutButton() {
  const { pending } = useFormStatus();
  const baseClass = "inline-flex items-center justify-center rounded-full border border-brand-navy bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/40 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <button type="submit" className={baseClass} disabled={pending}>
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
