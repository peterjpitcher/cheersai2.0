"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

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
            Authentication Error
          </h1>
          
          <p className="text-text-secondary mb-6">
            {message || "Something went wrong during authentication. This could be due to an expired link or an invalid request."}
          </p>
          
          <div className="space-y-3">
            <Link href="/auth/login" className="btn-primary w-full">
              Try logging in again
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