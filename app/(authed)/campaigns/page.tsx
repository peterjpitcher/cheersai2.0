import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Plus, Clock } from "lucide-react";
import CampaignCard from "./campaign-card";


export default async function CampaignsPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect("/auth/login");
  }

  // Get user's tenant
  const { data: userData } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!userData?.tenant_id) {
    redirect("/onboarding");
  }

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

  const activeCampaigns = campaigns?.filter(c => c.status === "active") || [];
  const draftCampaigns = campaigns?.filter(c => c.status === "draft") || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold">Campaigns</h1>
              <p className="text-sm text-text-secondary">
                {campaigns?.length || 0} total campaigns
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
              <Link href="/campaigns/new" className="btn-primary">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
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
            {/* Active Campaigns */}
            {activeCampaigns.length > 0 && (
              <section>
                <h2 className="text-xl font-heading font-bold mb-4">Active Campaigns</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.id} campaign={campaign} />
                  ))}
                </div>
              </section>
            )}

            {/* Draft Campaigns */}
            {draftCampaigns.length > 0 && (
              <section>
                <h2 className="text-xl font-heading font-bold mb-4">Drafts</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {draftCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.id} campaign={campaign} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}