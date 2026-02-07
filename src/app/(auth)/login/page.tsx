"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Mail } from "lucide-react";

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
      } catch { }
      setError(payload?.error ?? "Unable to send magic link. Try again shortly.");
      setIsSubmitting(false);
      return;
    }

    setSuccessMessage("Check your inbox for a one-time login link.");
    setIsSubmitting(false);
  }

  const isBusy = isSubmitting || isPending;

  return (
    <div className="w-full max-w-md mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-heading font-bold tracking-tight text-brand-navy dark:text-white">
          Welcome back
        </h1>
        <p className="text-muted-foreground">
          Enter your credentials to access your command centre
        </p>
      </div>

      <Card className="glass-panel border-white/40 dark:border-white/10 shadow-xl">
        <CardContent className="pt-6">
          <div className="grid gap-6">
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  className="bg-white/50 dark:bg-black/20"
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <a
                    href="#magic-link"
                    className="text-sm font-medium text-brand-teal hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  className="bg-white/50 dark:bg-black/20"
                />
              </div>
              <Button type="submit" className="w-full font-semibold" disabled={isBusy} variant="default">
                {isBusy ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-muted-foreground/20" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground bg-transparent backdrop-blur-md">
                  Or continue with
                </span>
              </div>
            </div>

            <form id="magic-link" onSubmit={handleMagicLink} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="magic-email">Email for Magic Link</Label>
                <Input id="magic-email" name="email" type="email" placeholder="m@example.com" required className="bg-white/50 dark:bg-black/20" />
              </div>
              <Button variant="outline" className="w-full" disabled={isBusy}>
                <Mail className="mr-2 h-4 w-4" /> Email me a magic link
              </Button>
            </form>

            {(error || successMessage) && (
              <div className={`p-3 rounded-md text-sm text-center font-medium ${error ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-200" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-200"}`}>
                {error ?? successMessage}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <a href="mailto:peter@orangejelly.co.uk" className="font-semibold text-brand-navy hover:underline dark:text-white">
          Contact support
        </a>
      </p>
    </div>
  );
}
