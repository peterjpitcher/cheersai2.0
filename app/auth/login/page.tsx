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
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Check if email is verified
    const user = data.user;
    if (!user?.email_confirmed_at) {
      await supabase.auth.signOut();
      setError("Please confirm your email first. Check your inbox for the confirmation link.");
      setLoading(false);
      return;
    }

    if (data?.session) {
      // Session created successfully, refresh the router
      router.refresh();
      router.push("/dashboard");
    } else {
      setError("Failed to create session. Please try again.");
      setLoading(false);
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-8">
            <Logo variant="full" />
          </div>
          <h1 className="text-3xl font-heading font-bold text-text-primary">Welcome back</h1>
          <p className="text-text-secondary mt-2">Sign in to your account</p>
        </div>

        {/* Login Form */}
        <Card>
          <CardContent className="p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="bg-error/10 text-error px-4 py-3 rounded-soft text-sm">
                {error}
              </div>
            )}

            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary/50" />
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
              <div className="flex justify-between items-center mb-1">
                <Label htmlFor="password">Password</Label>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary/50" />
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

            <Button type="submit" disabled={loading} className="w-full flex items-center justify-center">
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "Sign In"
              )}
            </Button>

            <div className="text-right mt-2">
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
              <span className="px-2 bg-surface text-text-secondary">Or continue with</span>
            </div>
          </div>

          <Button type="button" onClick={handleMagicLink} disabled={loading} variant="secondary" className="w-full">
            Send Magic Link
          </Button>

          <p className="text-center text-sm text-text-secondary mt-6">
            Don&apos;t have an account?{" "}
            <Link href="/auth/signup" className="text-primary font-medium hover:underline">
              Start free trial
            </Link>
          </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
