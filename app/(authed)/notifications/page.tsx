import Link from "next/link";
import { Bell, AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthWithCache } from "@/lib/supabase/auth-cache";

export const runtime = 'nodejs';

export default async function NotificationsPage() {
  const { tenantId } = await getAuthWithCache();
  const supabase = await createClient();

  let items: any[] = [];
  if (tenantId) {
    const { data } = await supabase
      .from('publishing_queue')
      .select(`
        id, created_at, scheduled_for, status, last_error, attempts,
        social_connections(platform, page_name),
        campaign_posts(
          id, content,
          campaigns(id, name)
        )
      `)
      .eq('status', 'failed')
      .eq('campaign_posts.campaigns.tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50);
    items = data || [];
  }

  const hasItems = items.length > 0;

  return (
    <div className="container mx-auto max-w-screen-lg px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-heading font-bold">Notifications</h2>
      </div>

      {!hasItems ? (
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
      ) : (
        <div className="rounded-medium border border-border bg-surface divide-y">
          {items.map((it) => {
            const platform = it.social_connections?.platform?.replace('_', ' ') || 'platform';
            const page = it.social_connections?.page_name || '';
            const campaignName = it.campaign_posts?.campaigns?.name || 'Campaign';
            return (
              <div key={it.id} className="p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">
                    Post publishing failed on {platform}{page ? ` · ${page}` : ''}
                  </p>
                  <p className="text-sm text-text-secondary mt-1 truncate">
                    {it.last_error || 'Unknown error'}
                  </p>
                  <p className="text-xs text-text-tertiary mt-1">
                    Campaign: {campaignName} · Attempts: {it.attempts || 1}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/campaigns/${it.campaign_posts?.campaigns?.id || ''}`} className="inline-flex items-center text-sm text-primary hover:underline">
                    Open Campaign <ExternalLink className="w-4 h-4 ml-1" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
