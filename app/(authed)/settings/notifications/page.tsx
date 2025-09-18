import { getUserAndTenant } from '@/lib/settings/service'
import { Bell, AlertCircle, Mail, CheckCircle } from "lucide-react";

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NotificationsSettingsPage() {
  const { user } = await getUserAndTenant()
  
  return (
    <div className="space-y-6">
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <Bell className="size-5 text-primary" />
          <h2 className="font-heading text-xl font-bold">Notification Settings</h2>
        </div>
        <p className="mb-6 text-sm text-text-secondary">
          Manage how you receive notifications from CheersAI
        </p>

        <div className="space-y-4">
          {/* Post Failure Notifications */}
          <div className="rounded-medium border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-5 text-warning" />
              <div className="flex-1">
                <h3 className="mb-2 font-semibold">Post Failure Notifications</h3>
                <p className="mb-3 text-text-secondary">
                  You will automatically receive email notifications when posts fail to publish to your connected social media accounts.
                </p>
                <div className="rounded-medium border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="size-4 text-primary" />
                    <span className="font-medium">Always Enabled</span>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    Critical notifications about failed posts are always sent to ensure you never miss important updates.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Email Delivery */}
          <div className="rounded-medium border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 size-5 text-primary" />
              <div className="flex-1">
                <h3 className="mb-2 font-semibold">Email Delivery</h3>
                <p className="mb-3 text-text-secondary">
                  Notifications will be sent to:
                </p>
                <div className="rounded-medium bg-gray-50 p-3">
                  <p className="font-mono text-sm">{user.email}</p>
                </div>
                <p className="mt-2 text-sm text-text-secondary">
                  To change your email address, update it in your account settings.
                </p>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="rounded-medium border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="mb-1 font-medium">Simplified Notifications</p>
                <p className="text-sm text-text-secondary">
                  We've simplified notifications to focus on what matters most - alerting you when posts fail to publish so you can take action quickly. 
                  All other updates and insights are available in your dashboard whenever you need them.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}