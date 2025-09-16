import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { 
  Sparkles, TrendingUp, Clock, Image
} from "lucide-react";
import { Card } from "@/components/ui/card";
import Link from "next/link";
import CalendarWidget from "@/components/dashboard/calendar-widget";
import Container from "@/components/layout/container";
import QuickPostButton from "@/components/dashboard/quick-post-button";

// Force dynamic rendering to prevent caching issues
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect("/");
  }

  // Fetch user profile without inner join (avoid RLS join pitfalls)
  const { data: userRow } = await supabase
    .from('users')
    .select('first_name, full_name, tenant_id, is_superadmin')
    .eq('id', user.id)
    .single();

  // Redirect superadmin to admin dashboard
  if (userRow?.is_superadmin) {
    redirect("/admin/dashboard");
  }

  // Determine tenant id: prefer users.tenant_id, fall back to membership
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
      // Best-effort persist (ignore errors)
      await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id);
    }
  }

  // Fail-open: if no tenant yet, render empty state instead of redirecting

  // Fetch tenant details separately (optional)
  let tenant: any = null;
  try {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('name, subscription_status, trial_ends_at')
      .eq('id', tenantId)
      .maybeSingle();
    tenant = tenantRow || null;
  } catch {}

  // Get actual metrics
  let campaignCount = 0;
  let postCount = 0;
  let mediaCount = 0;

  if (tenantId) {
    // Count campaigns
    const { count: campaigns } = await supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    
    campaignCount = campaigns || 0;

    // Count posts
    const { count: posts } = await supabase
      .from("campaign_posts")
      .select("*, campaign!inner(tenant_id)", { count: "exact", head: true })
      .eq("campaign.tenant_id", tenantId);
    
    postCount = posts || 0;

    // Count media assets
    const { count: media } = await supabase
      .from("media_assets")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    
    mediaCount = media || 0;
  }

  // Calculate trial days remaining
  const trialEndsAt = tenant?.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
  const daysRemaining = trialEndsAt ? Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;

  return (
    <>
      {/* Trial Banner */}
      {tenant?.subscription_status === 'trial' && (
        <div className="bg-warning/10 border-b border-warning/20 px-4 py-3 md:py-2">
          <div className="container mx-auto max-w-screen-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-3 sm:gap-2 text-center text-sm">
              <span className="text-warning font-medium">
                {daysRemaining} days left in your free trial
              </span>
              <Link 
                href="/settings/billing" 
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-primary text-primary-foreground rounded-md font-semibold transition-colors hover:bg-primary/90 text-sm sm:min-h-auto sm:px-3 sm:py-1 sm:bg-transparent sm:text-primary sm:hover:underline sm:hover:bg-transparent"
              >
                Upgrade now
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Calendar or Getting Started */}
      <Container className="pt-page-pt pb-page-pb">
      {campaignCount > 0 ? (
        <CalendarWidget />
      ) : (
        <Card className="bg-primary/5 border-primary/20">
          <div className="flex items-start gap-4 p-5 sm:p-6">
            <div className="bg-primary/10 p-3 rounded-chip">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-heading font-bold text-title-sm mb-2">Getting Started with CheersAI</h3>
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
              <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
                <Link 
                  href="/campaigns/new" 
                  className="bg-primary text-white rounded-md px-4 py-2 min-h-[44px] flex-1 sm:flex-initial sm:min-h-auto inline-flex items-center justify-center"
                >
                  Create Your First Campaign
                </Link>
                <Link 
                  href="/media" 
                  className="border border-input rounded-md px-4 py-2 min-h-[44px] flex-1 sm:flex-initial sm:min-h-auto inline-flex items-center justify-center"
                >
                  Upload Media First
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Quick Actions & Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        {/* Quick Post Button */}
        <QuickPostButton />
        
        {/* Stats */}
        <Card className="min-h-[80px] flex items-center">
          <div className="flex items-center gap-3 w-full p-4 sm:p-5">
            <div className="bg-success/10 p-3.5 sm:p-4 rounded-chip">
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-success" />
            </div>
            <div className="flex-1">
              <p className="text-number-lg sm:text-number-xl font-bold">{campaignCount}</p>
              <p className="text-sm text-text-secondary">Campaigns</p>
            </div>
          </div>
        </Card>
        
        <Card className="min-h-[80px] flex items-center">
          <div className="flex items-center gap-3 w-full p-4 sm:p-5">
            <div className="bg-primary/10 p-3.5 sm:p-4 rounded-chip">
              <Clock className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-number-lg sm:text-number-xl font-bold">{postCount}</p>
              <p className="text-sm text-text-secondary">Posts</p>
            </div>
          </div>
        </Card>
        
        <Card className="min-h-[80px] flex items-center">
          <div className="flex items-center gap-3 w-full p-4 sm:p-5">
            <div className="bg-secondary/10 p-3.5 sm:p-4 rounded-chip">
              <Image className="w-6 h-6 sm:w-8 sm:h-8 text-secondary" />
            </div>
            <div className="flex-1">
              <p className="text-number-lg sm:text-number-xl font-bold">{mediaCount}</p>
              <p className="text-sm text-text-secondary">Media</p>
            </div>
          </div>
        </Card>
      </div>
      </Container>
    </>
  );
}
