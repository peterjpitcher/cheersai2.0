import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { requireAuthContext } from '@/lib/auth/server';
import { reviewFromDb } from '@/types/reviews';
import { ReviewsList } from '@/features/reviews/ReviewsList';

export default async function ReviewsPage() {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Check if GBP connection exists
  const { data: connection } = await supabase
    .from('social_connections')
    .select('status, metadata')
    .eq('account_id', accountId)
    .eq('provider', 'gbp')
    .maybeSingle<{ status: string | null; metadata: Record<string, unknown> | null }>();

  const isConnected = connection?.status === 'active' && !!connection?.metadata?.locationId;

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <p className="text-muted-foreground text-lg">
          Connect your Google Business Profile to start managing reviews.
        </p>
        <a
          href="/connections"
          className="text-primary underline underline-offset-4 text-sm"
        >
          Go to Connections →
        </a>
      </div>
    );
  }

  const { data: rawReviews } = await supabase
    .from('gbp_reviews')
    .select('*')
    .eq('business_profile_id', accountId)
    .order('create_time', { ascending: false });

  const reviews = (rawReviews ?? []).map((r) => reviewFromDb(r as Record<string, unknown>));

  const lastSynced = reviews[0]?.syncedAt ?? null;
  const pendingCount = reviews.filter((r) => r.status === 'pending').length;
  const totalCount = reviews.length;
  const avgRating =
    totalCount > 0
      ? (reviews.reduce((sum, r) => sum + r.starRating, 0) / totalCount).toFixed(1)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Google Business Profile reviews for The Anchor
          </p>
        </div>
      </div>

      <ReviewsList
        reviews={reviews}
        lastSynced={lastSynced}
        pendingCount={pendingCount}
        avgRating={avgRating}
        totalCount={totalCount}
      />
    </div>
  );
}
