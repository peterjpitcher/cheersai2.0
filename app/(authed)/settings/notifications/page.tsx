"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Bell, ChevronLeft, AlertCircle, Mail, CheckCircle } from "lucide-react";
import Link from "next/link";

export default function NotificationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    setUserEmail(user.email || "");
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link 
              href="/settings" 
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold">Email Notifications</h1>
              <p className="text-sm text-text-secondary">
                Manage your notification preferences
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Current Settings Card */}
        <div className="card mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Bell className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-heading font-bold">Notification Settings</h2>
          </div>

          <div className="space-y-4">
            {/* Post Failure Notifications */}
            <div className="p-4 bg-surface rounded-medium border border-border">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-warning mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-2">Post Failure Notifications</h3>
                  <p className="text-text-secondary mb-3">
                    You will automatically receive email notifications when posts fail to publish to your connected social media accounts.
                  </p>
                  <div className="bg-primary/5 border border-primary/20 rounded-medium p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-primary" />
                      <span className="font-medium">Always Enabled</span>
                    </div>
                    <p className="text-sm text-text-secondary mt-1">
                      Critical notifications about failed posts are always sent to ensure you never miss important updates.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Email Delivery */}
            <div className="p-4 bg-surface rounded-medium border border-border">
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-2">Email Delivery</h3>
                  <p className="text-text-secondary mb-3">
                    Notifications will be sent to:
                  </p>
                  <div className="bg-gray-50 p-3 rounded-medium">
                    <p className="font-mono text-sm">{userEmail}</p>
                  </div>
                  <p className="text-sm text-text-secondary mt-2">
                    To change your email address, update it in your account settings.
                  </p>
                </div>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium mb-1">Simplified Notifications</p>
                  <p className="text-sm text-text-secondary">
                    We've simplified notifications to focus on what matters most - alerting you when posts fail to publish so you can take action quickly. 
                    All other updates and insights are available in your dashboard whenever you need them.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end">
          <Link href="/settings" className="btn-secondary">
            Back to Settings
          </Link>
        </div>
      </main>
    </div>
  );
}