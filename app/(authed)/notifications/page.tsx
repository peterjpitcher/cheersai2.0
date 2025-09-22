import Link from "next/link";
import { AlertCircle, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthWithCache } from "@/lib/supabase/auth-cache";

export const runtime = 'nodejs';

type QueueFailure = {
  id: string
  created_at: string
  scheduled_for: string | null
  status: string
  last_error: string | null
  attempts: number | null
  social_connections: {
    platform: string | null
    page_name: string | null
  } | null
  campaign_posts: {
    id: string
    content: string | null
    campaigns: {
      id: string
      name: string | null
    } | null
  } | null
}

type QueueFailureRow = {
  id: string
  created_at: string
  scheduled_for: string | null
  status: string
  last_error: string | null
  attempts: number | null
  social_connections: Array<{
    platform: string | null
    page_name: string | null
  }> | null
  campaign_posts: Array<{
    id: string
    content: string | null
    campaigns: Array<{
      id: string
      name: string | null
    }> | null
  }> | null
}

export default async function NotificationsPage() {
  const { tenantId } = await getAuthWithCache();
  const supabase = await createClient();

  let items: QueueFailure[] = [];
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
    const rows: QueueFailureRow[] = Array.isArray(data) ? (data as QueueFailureRow[]) : []
    items = rows.map((row) => {
      const connection = Array.isArray(row.social_connections) ? row.social_connections[0] ?? null : row.social_connections ?? null

      let campaignPost: QueueFailure['campaign_posts'] = null
      if (Array.isArray(row.campaign_posts) && row.campaign_posts[0]) {
        const first = row.campaign_posts[0]
        const campaignCandidate = Array.isArray(first.campaigns)
          ? first.campaigns[0] ?? null
          : first.campaigns ?? null

        campaignPost = {
          id: first.id,
          content: first.content,
          campaigns: campaignCandidate ? { id: campaignCandidate.id, name: campaignCandidate.name } : null,
        }
      }

      return {
        id: row.id,
        created_at: row.created_at,
        scheduled_for: row.scheduled_for,
        status: row.status,
        last_error: row.last_error,
        attempts: row.attempts,
        social_connections: connection,
        campaign_posts: campaignPost,
      }
    })
  }

  const hasItems = items.length > 0;

  return (
    <div>
      {!hasItems ? (
        <div className="rounded-card border border-border bg-card p-6 text-card-foreground shadow-card">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 text-text-secondary" />
            <div>
              <p className="mb-1 font-medium">No notifications to show</p>
              <p className="text-sm text-text-secondary">
                You’ll see alerts here if a scheduled post fails to publish. Manage your preferences in{' '}
                <Link href="/settings/notifications" className="text-primary hover:underline">Notification Settings</Link>.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="divide-y rounded-card border border-border bg-card text-card-foreground shadow-card">
          {items.map((it) => {
            const platform = it.social_connections?.platform?.replace('_', ' ') || 'platform';
            const page = it.social_connections?.page_name || '';
            const campaignName = it.campaign_posts?.campaigns?.name || 'Campaign';
            return (
              <div key={it.id} className="flex items-start gap-3 p-4">
                <AlertCircle className="mt-0.5 size-5 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Post publishing failed on {platform}{page ? ` · ${page}` : ''}
                  </p>
                  <p className="mt-1 truncate text-sm text-text-secondary">
                    {it.last_error || 'Unknown error'}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary/80">
                    Campaign: {campaignName} · Attempts: {it.attempts || 1}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/campaigns/${it.campaign_posts?.campaigns?.id || ''}`} className="inline-flex items-center text-sm text-primary hover:underline">
                    Open Campaign <ExternalLink className="ml-1 size-4" />
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
