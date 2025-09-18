"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const message = searchParams.get("message");
  const reason = searchParams.get("reason");

  // Provide helpful error messages based on reason
  let errorTitle = "Authentication Error";
  let errorMessage = message || "Something went wrong during authentication.";
  let showResendOption = false;
  let showLoginOption = false;

  if (reason === "expired_link" || reason === "Token has expired or is invalid") {
    errorTitle = "Link Expired";
    errorMessage = "This confirmation link has expired. Confirmation links are valid for 24 hours. Please request a new one.";
    showResendOption = true;
  } else if (reason === "already_used" || reason === "Token has already been used") {
    errorTitle = "Link Already Used";
    errorMessage = "This confirmation link has already been used. If you're having trouble logging in, try resetting your password.";
    showLoginOption = true;
  } else if (reason === "missing_params" || reason === "missing_code") {
    errorTitle = "Invalid Link";
    errorMessage = "This link appears to be invalid or incomplete. Please check your email for the correct link.";
    showResendOption = true;
  } else if (reason === "unexpected_error") {
    errorTitle = "Unexpected Error";
    errorMessage = "An unexpected error occurred. Please try again or contact support if the problem persists.";
  } else if (reason === "User already registered") {
    errorTitle = "Already Registered";
    errorMessage = "An account with this email already exists. Please log in or reset your password if you've forgotten it.";
    showLoginOption = true;
  } else if (reason?.includes("rate") || reason?.includes("limit")) {
    errorTitle = "Too Many Attempts";
    errorMessage = "You've made too many attempts. Please wait a few minutes before trying again.";
  } else if (reason?.includes("email") && reason?.includes("not")) {
    errorTitle = "Email Not Verified";
    errorMessage = "Your email address hasn't been verified yet. Please check your inbox for the confirmation email.";
    showResendOption = true;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md">
        <Card className="text-center">
          <CardContent className="p-6">
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-error/10 p-4">
              <AlertCircle className="size-12 text-error" />
            </div>
          </div>
          
          <h1 className="mb-4 font-heading text-2xl font-bold text-text-primary">
            {errorTitle}
          </h1>
          
          <p className="mb-6 text-text-secondary">
            {errorMessage}
          </p>
          
          <div className="space-y-3">
            {showResendOption && (
              <>
                <Link href="/#waitlist">
                  <Button className="w-full">Join the waitlist</Button>
                </Link>
                <p className="text-sm text-text-secondary">
                  We’ll email you when signups open again.
                </p>
              </>
            )}
            
            {showLoginOption && (
              <Link href="/auth/login">
                <Button className="w-full">Go to Login</Button>
              </Link>
            )}
            
            {!showResendOption && !showLoginOption && (
              <Link href="/auth/login">
                <Button className="w-full">Try Again</Button>
              </Link>
            )}
            
            <Link href="/auth/forgot-password" className="inline-flex w-full items-center justify-center rounded-md py-2 text-text-secondary hover:bg-muted">
              Reset Password
            </Link>
            
            <Link href="/" className="inline-flex items-center rounded-md px-3 py-2 text-text-secondary hover:bg-muted">
              <ArrowLeft className="mr-2 size-4" />
              Back to home
            </Link>
          </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><AlertCircle className="animate-pulse" /></div>}>
      <AuthErrorContent />
    </Suspense>
  );
}
