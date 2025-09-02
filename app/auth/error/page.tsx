"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-error/10 p-4 rounded-full">
              <AlertCircle className="w-12 h-12 text-error" />
            </div>
          </div>
          
          <h1 className="text-2xl font-heading font-bold text-text-primary mb-4">
            {errorTitle}
          </h1>
          
          <p className="text-text-secondary mb-6">
            {errorMessage}
          </p>
          
          <div className="space-y-3">
            {showResendOption && (
              <>
                <Link href="/auth/signup" className="btn-primary w-full">
                  Request New Confirmation Email
                </Link>
                <p className="text-sm text-text-secondary">
                  Sign up again with the same email to receive a new confirmation link
                </p>
              </>
            )}
            
            {showLoginOption && (
              <Link href="/auth/login" className="btn-primary w-full">
                Go to Login
              </Link>
            )}
            
            {!showResendOption && !showLoginOption && (
              <Link href="/auth/login" className="btn-primary w-full">
                Try Again
              </Link>
            )}
            
            <Link href="/auth/forgot-password" className="btn-ghost w-full">
              Reset Password
            </Link>
            
            <Link href="/" className="btn-ghost inline-flex items-center">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><AlertCircle className="animate-pulse" /></div>}>
      <AuthErrorContent />
    </Suspense>
  );
}