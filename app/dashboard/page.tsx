import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { 
  Calendar, Image, Sparkles, Settings, 
  Plus, TrendingUp, Clock, ChevronLeft, ChevronRight, Send
} from "lucide-react";
import Link from "next/link";
import Logo from "@/components/ui/logo";
import CalendarWidget from "@/components/dashboard/calendar-widget";
import QuickPostButton from "@/components/dashboard/quick-post-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect("/auth/login");
  }

  // Get user's tenant and brand info
  const { data: userData } = await supabase
    .from("users")
    .select(`
      full_name,
      tenant_id,
      tenant:tenants (
        name,
        subscription_status,
        trial_ends_at
      )
    `)
    .eq("id", user.id)
    .single();

  if (!userData?.tenant) {
    redirect("/onboarding");
  }

  // Get actual metrics
  let campaignCount = 0;
  let postCount = 0;
  let mediaCount = 0;

  if (userData?.tenant_id) {
    // Count campaigns
    const { count: campaigns } = await supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", userData.tenant_id);
    
    campaignCount = campaigns || 0;

    // Count posts
    const { count: posts } = await supabase
      .from("campaign_posts")
      .select("*, campaign!inner(tenant_id)", { count: "exact", head: true })
      .eq("campaign.tenant_id", userData.tenant_id);
    
    postCount = posts || 0;

    // Count media assets
    const { count: media } = await supabase
      .from("media_assets")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", userData.tenant_id);
    
    mediaCount = media || 0;
  }

  // Calculate trial days remaining
  const trialEndsAt = new Date(userData.tenant.trial_ends_at);
  const daysRemaining = Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Logo variant="icon" className="h-8" />
              <div>
                <h1 className="font-heading font-bold text-lg">{userData.tenant.name}</h1>
                <p className="text-sm text-text-secondary">Welcome back, {userData.full_name}</p>
              </div>
            </div>
            
            {userData.tenant.subscription_status === 'trial' && (
              <div className="badge-warning">
                {daysRemaining} days left in trial
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-2xl font-heading font-bold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <QuickPostButton />
            
            <Link href="/campaigns/new" className="card-interactive group">
              <div className="flex flex-col md:flex-row items-center md:gap-3 text-center md:text-left">
                <div className="bg-primary/10 p-3 rounded-medium group-hover:bg-primary/20 transition-colors mb-2 md:mb-0">
                  <Plus className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm md:text-base">New Campaign</p>
                  <p className="text-xs md:text-sm text-text-secondary hidden md:block">Create event posts</p>
                </div>
              </div>
            </Link>

            <Link href="/media" className="card-interactive group">
              <div className="flex flex-col md:flex-row items-center md:gap-3 text-center md:text-left">
                <div className="bg-secondary/10 p-3 rounded-medium group-hover:bg-secondary/20 transition-colors mb-2 md:mb-0">
                  <Image className="w-6 h-6 text-secondary" />
                </div>
                <div>
                  <p className="font-semibold text-sm md:text-base">Media</p>
                  <p className="text-xs md:text-sm text-text-secondary hidden md:block">Manage images</p>
                </div>
              </div>
            </Link>

            <Link href="/campaigns" className="card-interactive group">
              <div className="flex flex-col md:flex-row items-center md:gap-3 text-center md:text-left">
                <div className="bg-success/10 p-3 rounded-medium group-hover:bg-success/20 transition-colors mb-2 md:mb-0">
                  <Calendar className="w-6 h-6 text-success" />
                </div>
                <div>
                  <p className="font-semibold text-sm md:text-base">Campaigns</p>
                  <p className="text-xs md:text-sm text-text-secondary hidden md:block">View all campaigns</p>
                </div>
              </div>
            </Link>

            <Link href="/settings" className="card-interactive group md:flex hidden">
              <div className="flex flex-col md:flex-row items-center md:gap-3 text-center md:text-left">
                <div className="bg-warning/10 p-3 rounded-medium group-hover:bg-warning/20 transition-colors mb-2 md:mb-0">
                  <Settings className="w-6 h-6 text-warning" />
                </div>
                <div>
                  <p className="font-semibold text-sm md:text-base">Settings</p>
                  <p className="text-xs md:text-sm text-text-secondary hidden md:block">Brand & account</p>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* Calendar or Getting Started */}
        {campaignCount > 0 ? (
          <CalendarWidget tenantId={userData.tenant_id} />
        ) : (
          <div className="card bg-primary/5 border-primary/20">
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 p-3 rounded-medium">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-heading font-bold text-lg mb-2">Getting Started with CheersAI</h3>
                <p className="text-text-secondary mb-4">
                  Follow these steps to create your first AI-powered campaign:
                </p>
                <ol className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                    <span>Upload images to your media library</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                    <span>Create a campaign for your next event</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                    <span>Let AI generate perfectly timed posts</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">4</span>
                    <span>Download or copy content when ready to post</span>
                  </li>
                </ol>
                <Link href="/campaigns/new" className="btn-primary mt-4 inline-block">
                  Create Your First Campaign
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid md:grid-cols-3 gap-4 mt-8">
          <div className="card">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-8 h-8 text-success" />
              <div>
                <p className="text-2xl font-bold">{campaignCount}</p>
                <p className="text-sm text-text-secondary">Campaigns Created</p>
              </div>
            </div>
          </div>
          
          <div className="card">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{postCount}</p>
                <p className="text-sm text-text-secondary">Posts Generated</p>
              </div>
            </div>
          </div>
          
          <div className="card">
            <div className="flex items-center gap-3">
              <Image className="w-8 h-8 text-secondary" />
              <div>
                <p className="text-2xl font-bold">{mediaCount}</p>
                <p className="text-sm text-text-secondary">Media Assets</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav md:hidden">
        <div className="flex justify-around">
          <Link href="/dashboard" className="flex flex-col items-center p-2 text-primary">
            <Logo variant="icon" className="h-6" />
            <span className="text-xs mt-1">Home</span>
          </Link>
          <Link href="/campaigns" className="flex flex-col items-center p-2 text-text-secondary">
            <Calendar className="w-6 h-6" />
            <span className="text-xs mt-1">Campaigns</span>
          </Link>
          <Link href="/campaigns/new" className="flex flex-col items-center p-2 text-text-secondary">
            <Plus className="w-6 h-6" />
            <span className="text-xs mt-1">Create</span>
          </Link>
          <Link href="/media" className="flex flex-col items-center p-2 text-text-secondary">
            <Image className="w-6 h-6" />
            <span className="text-xs mt-1">Media</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center p-2 text-text-secondary">
            <Settings className="w-6 h-6" />
            <span className="text-xs mt-1">Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}