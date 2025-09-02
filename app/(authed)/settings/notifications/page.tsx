import { getUserAndTenant } from '@/lib/settings/service'
import { Bell, AlertCircle, Mail, CheckCircle } from "lucide-react";

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NotificationsSettingsPage() {
  const { user } = await getUserAndTenant()
  
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <Bell className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-heading font-bold">Notification Settings</h2>
        </div>
        <p className="text-text-secondary text-sm mb-6">
          Manage how you receive notifications from CheersAI
        </p>

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
                  <p className="font-mono text-sm">{user.email}</p>
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
    </div>
  );
}