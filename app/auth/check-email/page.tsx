"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Mail, ArrowLeft, RefreshCw, Check } from "lucide-react";

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResendEmail = async () => {
    if (!email) {
      setError("Email address not found. Please try signing up again.");
      return;
    }

    setResending(true);
    setError(null);
    
    const supabase = createClient();
    
    // Resend confirmation email
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: email,
    });

    setResending(false);

    if (resendError) {
      setError(resendError.message);
    } else {
      setResent(true);
      // Reset the success message after 5 seconds
      setTimeout(() => setResent(false), 5000);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md">
        <Card className="p-6 text-center">
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-success/10 p-4">
              <Mail className="size-12 text-success" />
            </div>
          </div>
          
          <h1 className="mb-4 font-heading text-2xl font-bold text-text-primary">
            Check your email
          </h1>
          
          <p className="mb-6 text-text-secondary">
            We&apos;ve sent a confirmation email to{" "}
            {email && (
              <span className="font-medium text-text-primary">{email}</span>
            )}
            . Please click the link in the email to activate your account.
          </p>
          
          <div className="mb-6 space-y-2 rounded-medium bg-primary/5 p-4">
            <p className="text-sm text-text-secondary">
              <strong>Important:</strong> Open the confirmation link in the same browser you used to sign up.
            </p>
            <p className="text-sm text-text-secondary">
              <strong>Tip:</strong> Check your spam folder if you don&apos;t see the email in your inbox.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-soft bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </div>
          )}

          {resent && (
            <div className="mb-4 flex items-center justify-center rounded-soft bg-success/10 px-4 py-3 text-sm text-success">
              <Check className="mr-2 size-4" />
              Confirmation email resent successfully!
            </div>
          )}
          
          <div className="space-y-3">
            <Button onClick={handleResendEmail} disabled={resending || !email} variant="secondary" className="flex w-full items-center justify-center">
              {resending ? (
                <>
                  <RefreshCw className="mr-2 size-4 animate-spin" />
                  Resending...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 size-4" />
                  Resend confirmation email
                </>
              )}
            </Button>
            
            <Link href="/auth/login" className="inline-flex items-center rounded-md px-3 py-2 text-text-secondary hover:bg-muted">
              <ArrowLeft className="mr-2 size-4" />
              Back to login
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
        <div className="w-full max-w-md">
          <Card className="p-6 text-center">
            <Mail className="mx-auto size-12 animate-pulse text-primary" />
          </Card>
        </div>
      </div>
    }>
      <CheckEmailContent />
    </Suspense>
  );
}
