import Link from "next/link";
import { Mail, ArrowLeft } from "lucide-react";

export default function CheckEmailPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-success/10 p-4 rounded-full">
              <Mail className="w-12 h-12 text-success" />
            </div>
          </div>
          
          <h1 className="text-2xl font-heading font-bold text-text-primary mb-4">
            Check your email
          </h1>
          
          <p className="text-text-secondary mb-6">
            We&apos;ve sent you a confirmation email. Please click the link in the email to activate your account.
          </p>
          
          <div className="bg-primary/5 p-4 rounded-medium mb-6">
            <p className="text-sm text-text-secondary">
              <strong>Tip:</strong> Check your spam folder if you don&apos;t see the email in your inbox.
            </p>
          </div>
          
          <Link href="/auth/login" className="btn-ghost inline-flex items-center">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}