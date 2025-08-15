import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function ConfirmPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-success/10 p-4 rounded-full">
              <CheckCircle className="w-12 h-12 text-success" />
            </div>
          </div>
          
          <h1 className="text-2xl font-heading font-bold text-text-primary mb-4">
            Email Confirmed!
          </h1>
          
          <p className="text-text-secondary mb-6">
            Your email has been successfully confirmed. You can now log in to your account.
          </p>
          
          <Link href="/auth/login" className="btn-primary w-full">
            Continue to Login
          </Link>
        </div>
      </div>
    </div>
  );
}