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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="text-center p-6">
          <div className="flex justify-center mb-6">
            <div className="bg-success/10 p-4 rounded-full">
              <Mail className="w-12 h-12 text-success" />
            </div>
          </div>
          
          <h1 className="text-2xl font-heading font-bold text-text-primary mb-4">
            Check your email
          </h1>
          
          <p className="text-text-secondary mb-6">
            We&apos;ve sent a confirmation email to{" "}
            {email && (
              <span className="font-medium text-text-primary">{email}</span>
            )}
            . Please click the link in the email to activate your account.
          </p>
          
          <div className="bg-primary/5 p-4 rounded-medium mb-6 space-y-2">
            <p className="text-sm text-text-secondary">
              <strong>Important:</strong> Open the confirmation link in the same browser you used to sign up.
            </p>
            <p className="text-sm text-text-secondary">
              <strong>Tip:</strong> Check your spam folder if you don&apos;t see the email in your inbox.
            </p>
          </div>

          {error && (
            <div className="bg-error/10 text-error px-4 py-3 rounded-soft text-sm mb-4">
              {error}
            </div>
          )}

          {resent && (
            <div className="bg-success/10 text-success px-4 py-3 rounded-soft text-sm mb-4 flex items-center justify-center">
              <Check className="w-4 h-4 mr-2" />
              Confirmation email resent successfully!
            </div>
          )}
          
          <div className="space-y-3">
            <Button onClick={handleResendEmail} disabled={resending || !email} variant="secondary" className="w-full flex items-center justify-center">
              {resending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Resending...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Resend confirmation email
                </>
              )}
            </Button>
            
            <Link href="/auth/login" className="text-text-secondary hover:bg-muted rounded-md inline-flex items-center py-2 px-3">
              <ArrowLeft className="w-4 h-4 mr-2" />
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
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card className="text-center p-6">
            <Mail className="w-12 h-12 text-primary mx-auto animate-pulse" />
          </Card>
        </div>
      </div>
    }>
      <CheckEmailContent />
    </Suspense>
  );
}
