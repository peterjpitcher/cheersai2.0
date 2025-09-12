import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Container from "@/components/layout/container";
import EmptyState from "@/components/ui/empty-state";
import { Calendar, Plus, Clock } from "lucide-react";
import CampaignCard from "./campaign-card";
import CampaignFilters from "./campaign-filters";
import SubNav from "@/components/navigation/sub-nav";


export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
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

  // Calculate trial status
  // Fetch tenant display info (non-fatal if RLS blocks)
  let tenant: any = null;
  try {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('subscription_status, subscription_tier, total_campaigns_created')
      .eq('id', tenantId)
      .maybeSingle();
    tenant = tenantRow || null;
  } catch {}
  const isTrialing = tenant?.subscription_status === 'trialing' || tenant?.subscription_status === null;
  const totalCampaigns = tenant?.total_campaigns_created || 0;

  // Get status filter from URL params
  const statusFilter = searchParams.status || "all";

  // Get campaigns with post count
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(`
      *,
      hero_image:media_assets (
        file_url
      ),
      campaign_posts (
        id
      )
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  // Filter campaigns based on URL param
  const filteredCampaigns = campaigns?.filter(campaign => {
    if (statusFilter === "all") return true;
    if (statusFilter === "active") return campaign.status === "active";
    if (statusFilter === "draft") return campaign.status === "draft";
    if (statusFilter === "completed") {
      // A campaign is "completed" if it's active but the event date has passed
      return campaign.status === "active" && new Date(campaign.event_date) < new Date();
    }
    return true;
  }) || [];

  // For stats display
  const activeCampaigns = campaigns?.filter(c => c.status === "active") || [];
  const draftCampaigns = campaigns?.filter(c => c.status === "draft") || [];
  const completedCampaigns = campaigns?.filter(c => 
    c.status === "active" && new Date(c.event_date) < new Date()
  ) || [];

  return (
    <div className="min-h-screen bg-background">
      <SubNav base="/campaigns" preset="campaignsRoot" />
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">Campaigns</h1>
              <p className="text-sm text-text-secondary">
                {isTrialing ? (
                  <>{totalCampaigns} of 10 free trial campaigns used</>
                ) : (
                  <>{campaigns?.length || 0} total campaigns</>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/publishing/queue" className="border border-input rounded-md h-10 px-4 text-sm inline-flex items-center">
                <Clock className="w-4 h-4 mr-2" />
                Queue Monitor
              </Link>
              <Link href="/dashboard" className="text-text-secondary hover:bg-muted rounded-md h-10 px-4 text-sm inline-flex items-center">
                Back
              </Link>
              <Link 
                href="/campaigns/new" 
                className={`bg-primary text-white rounded-md h-10 px-4 text-sm inline-flex items-center ${isTrialing && totalCampaigns >= 10 ? 'opacity-50 pointer-events-none' : ''}`}
                title={isTrialing && totalCampaigns >= 10 ? 'Trial limit reached - upgrade to continue' : ''}
              >
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Link>
            </div>
          </div>
        </Container>
      </header>

      <main>
        <Container className="pt-6 pb-8">
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
            icon={<Calendar className="w-10 h-10" />}
            title="No campaigns yet"
            body="Create your first campaign to start generating AI‑powered content."
            primaryCta={{ label: 'Create First Campaign', href: '/campaigns/new' }}
          />
        ) : (
          <div className="space-y-8">
            {/* Filtered Campaigns */}
            {filteredCampaigns.length > 0 ? (
              <section>
                <h2 className="text-xl font-heading font-bold mb-4">
                  {statusFilter === "all" && "All Campaigns"}
                  {statusFilter === "active" && "Active Campaigns"}
                  {statusFilter === "draft" && "Draft Campaigns"}
                  {statusFilter === "completed" && "Completed Campaigns"}
                </h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.id} campaign={campaign} />
                  ))}
                </div>
              </section>
            ) : (
              <EmptyState
                icon={<Calendar className="w-10 h-10" />}
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
