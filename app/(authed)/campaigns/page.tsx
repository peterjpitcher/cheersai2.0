import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Container from "@/components/layout/container";
import EmptyState from "@/components/ui/empty-state";
import { Calendar } from "lucide-react";
import CampaignCard from "./campaign-card";
import CampaignFilters from "./campaign-filters";
import type { DatabaseWithoutInternals } from '@/lib/database.types'


export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect("/");
  }

  // Get user's tenant id; avoid inner joins and recover from membership
  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  let tenantId = userRow?.tenant_id as string | null | undefined;
  if (!tenantId) {
    const { data: membership } = await supabase
      .from('user_tenants')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membership?.tenant_id) {
      tenantId = membership.tenant_id as string;
      // Best-effort: persist onto users for simpler gating elsewhere
      await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id);
    }
  }

  if (!tenantId) {
    // Ensure a users row exists at least
    const { data: userExists } = await supabase.from('users').select('id').eq('id', user.id).maybeSingle();
    if (!userExists) {
      await supabase.from('users').insert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
        first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
        last_name: user.user_metadata?.last_name || '',
      });
    }
    redirect('/onboarding');
  }

  // Get status filter from URL params
  const statusFilter = resolvedSearchParams.status || "all";

  // Get campaigns with post count
  type CampaignRow = DatabaseWithoutInternals['public']['Tables']['campaigns']['Row']
  type CampaignWithRelations = CampaignRow & {
    hero_image: { file_url: string | null } | ({ file_url: string | null } | null)[] | null
    campaign_posts: { id: string }[] | null
  }

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(`
      *,
      hero_image:media_assets!campaigns_hero_image_id_fkey (
        file_url
      ),
      campaign_posts (
        id
      )
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .returns<CampaignWithRelations[]>();

  // Filter campaigns based on URL param
  const filteredCampaigns = campaigns?.filter(campaign => {
    if (statusFilter === "all") return true;
    if (statusFilter === "active") return campaign.status === "active";
    if (statusFilter === "draft") return campaign.status === "draft";
    if (statusFilter === "completed") {
      // A campaign is "completed" if it's active but the event date has passed
      if (!campaign.event_date) return false;
      return campaign.status === "active" && new Date(campaign.event_date) < new Date();
    }
    return true;
  }) || [];

  // For stats display
  const activeCampaigns = campaigns?.filter(c => c.status === "active") || [];
  const draftCampaigns = campaigns?.filter(c => c.status === "draft") || [];
  const completedCampaigns = campaigns?.filter(c => {
    if (!c.event_date) return false;
    return c.status === "active" && new Date(c.event_date) < new Date();
  }) || [];

  return (
    <div className="min-h-screen bg-background">
      <main>
        <Container className="pb-page-pb pt-page-pt">
        {/* Campaign Filters */}
        <CampaignFilters 
          currentFilter={statusFilter}
          counts={{
            all: campaigns?.length || 0,
            active: activeCampaigns.length,
            draft: draftCampaigns.length,
            completed: completedCampaigns.length
          }}
        />
        {campaigns?.length === 0 ? (
          <EmptyState
            icon={<Calendar className="size-10" />}
            title="No campaigns yet"
            body="Create your first campaign to start generating AI‑powered content."
            primaryCta={{ label: 'Create First Campaign', href: '/campaigns/new' }}
          />
        ) : (
          <div className="space-y-8">
            {/* Filtered Campaigns */}
            {filteredCampaigns.length > 0 ? (
              <section>
                <h2 className="mb-4 font-heading text-title-sm font-bold">
                  {statusFilter === "all" && "All Campaigns"}
                  {statusFilter === "active" && "Active Campaigns"}
                  {statusFilter === "draft" && "Draft Campaigns"}
                  {statusFilter === "completed" && "Completed Campaigns"}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {filteredCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.id} campaign={campaign} />
                  ))}
                </div>
              </section>
            ) : (
              <EmptyState
                icon={<Calendar className="size-10" />}
                title={`No ${statusFilter === 'all' ? '' : statusFilter} campaigns found`}
                body={
                  statusFilter === 'draft' ? "You don't have any draft campaigns yet." :
                  statusFilter === 'active' ? "You don't have any active campaigns yet." :
                  statusFilter === 'completed' ? "You don't have any completed campaigns yet." :
                  "Create your first campaign to get started."
                }
                primaryCta={{ label: 'Create Campaign', href: '/campaigns/new' }}
              />
            )}
          </div>
        )}
        </Container>
      </main>
    </div>
  );
}
