import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Plus, Clock } from "lucide-react";
import CampaignCard from "./campaign-card";
import CampaignFilters from "./campaign-filters";


export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect("/auth/login");
  }

  // Get user's tenant with subscription info
  const { data: userData } = await supabase
    .from("users")
    .select(`
      tenant_id,
      tenant:tenants (
        subscription_status,
        subscription_tier,
        total_campaigns_created
      )
    `)
    .eq("id", user.id)
    .single();

  if (!userData?.tenant_id) {
    redirect("/onboarding");
  }

  // Calculate trial status
  const tenant = userData.tenant as any;
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
    .eq("tenant_id", userData.tenant_id)
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
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
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
              <Link href="/publishing/queue" className="btn-secondary">
                <Clock className="w-4 h-4 mr-2" />
                Queue Monitor
              </Link>
              <Link href="/dashboard" className="btn-ghost">
                Back
              </Link>
              <Link 
                href="/campaigns/new" 
                className={`btn-primary ${isTrialing && totalCampaigns >= 10 ? 'opacity-50 pointer-events-none' : ''}`}
                title={isTrialing && totalCampaigns >= 10 ? 'Trial limit reached - upgrade to continue' : ''}
              >
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
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
          <div className="text-center py-16">
            <div className="bg-primary/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Calendar className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-heading font-bold mb-2">No campaigns yet</h2>
            <p className="text-text-secondary mb-6">
              Create your first campaign to start generating AI-powered content
            </p>
            <Link href="/campaigns/new" className="btn-primary">
              <Plus className="w-4 h-4 mr-2" />
              Create First Campaign
            </Link>
          </div>
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
              <div className="text-center py-16">
                <div className="bg-primary/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Calendar className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-2xl font-heading font-bold mb-2">
                  No {statusFilter === "all" ? "" : statusFilter} campaigns found
                </h2>
                <p className="text-text-secondary mb-6">
                  {statusFilter === "draft" && "You don't have any draft campaigns yet."}
                  {statusFilter === "active" && "You don't have any active campaigns yet."}
                  {statusFilter === "completed" && "You don't have any completed campaigns yet."}
                  {statusFilter === "all" && "Create your first campaign to get started."}
                </p>
                <Link href="/campaigns/new" className="btn-primary">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Campaign
                </Link>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}