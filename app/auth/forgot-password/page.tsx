"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setSubmitted(true);
      } else {
        setError(data.error || "Something went wrong");
      }
    } catch {
      setError("Failed to send reset email");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mb-8 flex justify-center">
              <Logo variant="full" />
            </div>
            <h1 className="font-heading text-3xl font-bold text-text-primary">Check your email</h1>
            <p className="mt-2 text-text-secondary">
              We&apos;ve sent a password reset link to {email}
            </p>
          </div>

          <Card>
            <CardContent className="p-6">
            <p className="mb-6 text-sm text-text-secondary">
              If an account exists with this email address, you will receive a password reset link. 
              Please check your inbox and spam folder.
            </p>
            
            <Link href="/auth/login">
              <Button variant="secondary" className="w-full">Back to Login</Button>
            </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-8 flex justify-center">
            <Logo variant="full" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-text-primary">Forgot password?</h1>
          <p className="mt-2 text-text-secondary">
            No worries, we&apos;ll send you reset instructions
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <Button type="submit" disabled={loading} className="flex w-full items-center justify-center">
              {loading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                "Send Reset Link"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link 
              href="/auth/login" 
              className="flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-primary"
            >
              <ArrowLeft className="size-4" />
              Back to Login
            </Link>
          </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
