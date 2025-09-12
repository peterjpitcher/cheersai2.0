import Link from "next/link";
import { Bell, AlertCircle } from "lucide-react";

export const runtime = 'nodejs';

export default async function NotificationsPage() {
  return (
    <div className="container mx-auto max-w-screen-lg px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-heading font-bold">Notifications</h2>
      </div>

      <div className="rounded-medium border border-border p-6 bg-surface">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-text-secondary mt-0.5" />
          <div>
            <p className="font-medium mb-1">No notifications to show</p>
            <p className="text-sm text-text-secondary">
              You’ll see alerts here if a scheduled post fails to publish. Manage your preferences in{' '}
              <Link href="/settings/notifications" className="text-primary hover:underline">Notification Settings</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

