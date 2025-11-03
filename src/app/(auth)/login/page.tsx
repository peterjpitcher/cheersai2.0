"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setError("Enter email and password to continue.");
      return;
    }

    setIsSubmitting(true);

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch (networkError) {
      setError(networkError instanceof Error ? networkError.message : "Network error. Try again.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);

    if (!response.ok) {
      let payload: { error?: string } | null = null;
      try {
        payload = await response.json();
      } catch {
        // ignore JSON parse errors
      }

      setError(payload?.error ?? "Unable to sign in. Check your credentials and try again.");
      return;
    }

    setSuccessMessage("Signed in. Redirecting to your workspace...");

    startTransition(() => {
      router.replace("/planner");
      router.refresh();
    });
  }

  async function handleMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    if (!email) {
      setError("Enter your email address to receive a magic link.");
      return;
    }

    setIsSubmitting(true);

    const redirectTo = `${window.location.origin}/planner`;
    let response: Response;

    try {
      response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo }),
      });
    } catch (networkError) {
      setError(networkError instanceof Error ? networkError.message : "Network error. Try again.");
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      let payload: { error?: string } | null = null;
      try {
        payload = await response.json();
      } catch {
        // ignore JSON parse errors
      }
      setError(payload?.error ?? "Unable to send magic link. Try again shortly.");
      setIsSubmitting(false);
      return;
    }

    setSuccessMessage("Check your inbox for a one-time login link.");
    setIsSubmitting(false);
  }

  const isBusy = isSubmitting || isPending;

  return (
    <div className="space-y-10">
      <header className="space-y-3 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-brand-teal">CheersAI</p>
        <h1 className="text-3xl font-semibold">Sign in to Command Centre</h1>
        <p className="text-sm text-white/70">Secure access for venue operators and internal team members.</p>
      </header>

      <section className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-white/70" htmlFor="email">
              Email
            </label>
            <input
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-base text-white outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/40"
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-white/70" htmlFor="password">
              Password
            </label>
            <input
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-base text-white outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/40"
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            className="w-full rounded-xl bg-brand-ambergold px-4 py-2 text-base font-semibold text-white shadow-lg transition hover:bg-brand-ambergold/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-ambergold focus:ring-offset-slate-950"
            type="submit"
            disabled={isBusy}
          >
            {isBusy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <span className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-transparent px-2 text-white/50">or</span>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleMagicLink}>
          <p className="text-sm text-white/70">Use a one-time link if you have not set a password yet.</p>
          <input type="hidden" name="password" value="" />
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-white/70" htmlFor="magic-email">
              Email
            </label>
            <input
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-base text-white outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/40"
              id="magic-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <button
            className="w-full rounded-xl bg-brand-ambergold px-4 py-2 text-base font-semibold text-white shadow-lg transition hover:bg-brand-ambergold/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-ambergold focus:ring-offset-slate-950"
            type="submit"
            disabled={isBusy}
          >
            {isBusy ? "Sending magic link..." : "Email me a magic link"}
          </button>
        </form>

        {(error || successMessage) && (
          <p className={`text-center text-sm ${error ? "text-rose-300" : "text-emerald-300"}`}>
            {error ?? successMessage}
          </p>
        )}
      </section>

      <footer className="space-y-3 text-center text-xs text-white/60">
        <p>Need access? Contact the CheersAI team to have your account provisioned.</p>
        <p className="text-white/70">
          CheersAI is wholly owned by{" "}
          <a className="underline transition hover:text-white" href="https://www.orangejelly.co.uk" target="_blank" rel="noopener noreferrer">
            Orange Jelly Limited
          </a>
          .
        </p>
        <nav className="flex items-center justify-center gap-3 text-white/70">
          <a className="transition hover:text-white" href="https://www.cheersai.uk/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          <span aria-hidden="true">•</span>
          <a className="transition hover:text-white" href="mailto:peter@orangejelly.co.uk">
            Contact
          </a>
        </nav>
      </footer>
    </div>
  );
}
