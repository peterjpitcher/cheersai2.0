"use client";

import Link from "next/link";
import Logo from "@/components/ui/logo";
import WaitlistForm from "@/components/waitlist/form";

export default function SignupPage() {
  const signupsEnabled = process.env.NEXT_PUBLIC_SIGNUPS_ENABLED === 'true'

  if (!signupsEnabled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-8">
              <Logo variant="full" />
            </div>
            <h1 className="text-3xl font-heading font-bold text-text-primary">Signups are currently closed</h1>
            <p className="text-text-secondary mt-2">Leave your email to join the waitlist and be the first to know.</p>
          </div>
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
            <WaitlistForm />
            <p className="text-center text-sm text-text-secondary mt-4">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-primary font-medium hover:underline">
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center text-text-secondary">
        <p>Signups are temporarily disabled.</p>
      </div>
    </div>
  )
}
