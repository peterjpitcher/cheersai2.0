import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Sparkles,
  TrendingUp,
  Clock,
  Image,
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
  let tenantId: string | null = userRow?.tenant_id ?? null;
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
      tenantId = membership.tenant_id;
      // Best-effort persist (ignore errors)
      await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id);
    }
  }

  // Fail-open: if no tenant yet, render empty state instead of redirecting

  // Fetch tenant details separately (optional)
  type TenantSummary = {
    name: string | null;
    subscription_status: string | null;
    trial_ends_at: string | null;
  };

  let tenant: TenantSummary | null = null;
  try {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('name, subscription_status, trial_ends_at')
      .eq('id', tenantId)
      .maybeSingle();
    tenant = tenantRow ?? null;
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
        <div className="border-b border-warning/20 bg-warning/10 px-4 py-3 md:py-2">
          <div className="container mx-auto max-w-screen-2xl">
            <div className="flex flex-col gap-3 text-center text-sm sm:flex-row sm:items-center sm:justify-center sm:gap-2">
              <span className="font-medium text-warning">
                {daysRemaining} days left in your free trial
              </span>
              <Link 
                href="/settings/billing" 
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:bg-transparent sm:px-3 sm:py-1 sm:text-primary sm:hover:bg-transparent sm:hover:underline"
              >
                Upgrade now
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Calendar or Getting Started */}
      <Container className="pb-page-pb pt-page-pt">
      {campaignCount > 0 ? (
        <CalendarWidget />
      ) : (
        <Card className="border-primary/20 bg-primary/5">
          <div className="flex items-start gap-4 p-5 sm:p-6">
            <div className="rounded-chip bg-primary/10 p-3">
              <Sparkles className="size-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="mb-2 font-heading text-title-sm font-bold">Getting Started with CheersAI</h3>
              <p className="mb-4 text-text-secondary">
                Follow these steps to create your first AI-powered campaign:
              </p>
              <ol className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</span>
                  <span>Upload images to your media library</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">2</span>
                  <span>Create a campaign for your next event</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">3</span>
                  <span>Let AI generate perfectly timed posts</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">4</span>
                  <span>Download or copy content when ready to post</span>
                </li>
              </ol>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:gap-4">
                <Link 
                  href="/campaigns/new" 
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-primary px-4 py-2 text-white sm:flex-initial"
                >
                  Create Your First Campaign
                </Link>
                <Link 
                  href="/media" 
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-input px-4 py-2 sm:flex-initial"
                >
                  Upload Media First
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Quick Actions & Stats */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Quick Post Button */}
        <QuickPostButton />
        
        {/* Stats */}
        <Card className="flex min-h-[80px] items-center">
          <div className="flex w-full items-center gap-3 p-4 sm:p-5">
            <div className="rounded-chip bg-success/10 p-3.5 sm:p-4">
              <TrendingUp className="size-6 text-success sm:size-8" />
            </div>
            <div className="flex-1">
              <p className="text-number-lg font-bold sm:text-number-xl">{campaignCount}</p>
              <p className="text-sm text-text-secondary">Campaigns</p>
            </div>
          </div>
        </Card>
        
        <Card className="flex min-h-[80px] items-center">
          <div className="flex w-full items-center gap-3 p-4 sm:p-5">
            <div className="rounded-chip bg-primary/10 p-3.5 sm:p-4">
              <Clock className="size-6 text-primary sm:size-8" />
            </div>
            <div className="flex-1">
              <p className="text-number-lg font-bold sm:text-number-xl">{postCount}</p>
              <p className="text-sm text-text-secondary">Posts</p>
            </div>
          </div>
        </Card>
        
        <Card className="flex min-h-[80px] items-center">
          <div className="flex w-full items-center gap-3 p-4 sm:p-5">
            <div className="rounded-chip bg-secondary/10 p-3.5 sm:p-4">
              <Image className="size-6 text-secondary sm:size-8" />
            </div>
            <div className="flex-1">
              <p className="text-number-lg font-bold sm:text-number-xl">{mediaCount}</p>
              <p className="text-sm text-text-secondary">Media</p>
            </div>
          </div>
        </Card>
      </div>
      </Container>
    </>
  );
}
