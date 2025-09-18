"use client";

import Link from "next/link";
import Logo from "@/components/ui/logo";
import WaitlistForm from "@/components/waitlist/form";

export default function SignupPage() {
  const signupsEnabled = process.env.NEXT_PUBLIC_SIGNUPS_ENABLED === 'true'

  if (!signupsEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mb-8 flex justify-center">
              <Logo variant="full" />
            </div>
            <h1 className="font-heading text-3xl font-bold text-text-primary">Signups are currently closed</h1>
            <p className="mt-2 text-text-secondary">Leave your email to join the waitlist and be the first to know.</p>
          </div>
          <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
            <WaitlistForm />
            <p className="mt-4 text-center text-sm text-text-secondary">
              Already have an account?{" "}
              <Link href="/auth/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    )
  }

  // If signups are enabled in future, this page can be restored via VCS
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md text-center text-text-secondary">
        <p>Signups are temporarily disabled.</p>
      </div>
    </div>
  )
}
