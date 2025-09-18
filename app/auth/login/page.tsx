"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Mail, Lock, Loader2 } from "lucide-react";
import { toast } from 'sonner';
import Logo from "@/components/ui/logo";
import { getBaseUrl } from "@/lib/utils/get-app-url";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const signupsEnabled = process.env.NEXT_PUBLIC_SIGNUPS_ENABLED === 'true'
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const resp = await fetch('/api/auth/password-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}))
        const msg = j?.error?.message || j?.message || 'Sign-in failed'
        setError(msg)
        setLoading(false)
        return
      }
      // Session cookies set by server; navigate to dashboard
      router.refresh()
      router.push('/dashboard')
    } catch (err) {
      setError('Failed to sign in. Please try again.')
      setLoading(false)
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      setError("Please enter your email address");
      return;
    }

    setError(null);
    setLoading(true);

    const supabase = createClient();
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${getBaseUrl()}/auth/confirm`,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setError(null);
    toast.success("Check your email for the magic link!");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-8 flex justify-center">
            <Logo variant="full" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-text-primary">Welcome back</h1>
          <p className="mt-2 text-text-secondary">Sign in to your account</p>
        </div>

        {/* Login Form */}
        <Card>
          <CardContent className="p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="rounded-soft bg-error/10 px-4 py-3 text-sm text-error">
                {error}
              </div>
            )}

            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-secondary/50" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  placeholder="your@pub.com"
                  required
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-secondary/50" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="flex w-full items-center justify-center">
              {loading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                "Sign In"
              )}
            </Button>

            <div className="mt-2 text-right">
              <Link 
                href="/auth/reset-password" 
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-surface px-2 text-text-secondary">Or continue with</span>
            </div>
          </div>

          <Button type="button" onClick={handleMagicLink} disabled={loading} variant="secondary" className="w-full">
            Send Magic Link
          </Button>

          <p className="mt-6 text-center text-sm text-text-secondary">
            Don&apos;t have an account?{" "}
            {signupsEnabled ? (
              <Link href="/auth/signup" className="font-medium text-primary hover:underline">
                Start free trial
              </Link>
            ) : (
              <Link href="/#waitlist" className="font-medium text-primary hover:underline">
                Join the waitlist
              </Link>
            )}
          </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
