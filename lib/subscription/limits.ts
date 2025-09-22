import { createClient } from "@/lib/supabase/server";
import { getTierLimits } from "@/lib/stripe/config";

export async function checkCampaignLimit(tenantId: string): Promise<{ allowed: boolean; message?: string }> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier")
    .eq("id", tenantId)
    .single();
  
  if (!tenant) {
    return { allowed: false, message: "Tenant not found" };
  }
  
  const limits = getTierLimits(tenant.subscription_tier ?? 'trial');
  
  // Check if unlimited
  if (limits.campaigns === -1) {
    return { allowed: true };
  }
  
  // Count existing campaigns
  const { count } = await supabase
    .from("campaigns")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  
  if ((count || 0) >= limits.campaigns) {
    return { 
      allowed: false, 
      message: `You've reached your campaign limit (${limits.campaigns}). Upgrade your plan to create more campaigns.`
    };
  }
  
  return { allowed: true };
}

export async function checkPostLimit(tenantId: string, postsToCreate: number = 1): Promise<{ allowed: boolean; message?: string }> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier")
    .eq("id", tenantId)
    .single();
  
  if (!tenant) {
    return { allowed: false, message: "Tenant not found" };
  }
  
  const limits = getTierLimits(tenant.subscription_tier ?? 'trial');
  
  // Check if unlimited
  if (limits.posts === -1) {
    return { allowed: true };
  }
  
  // Count existing posts this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const { count } = await supabase
    .from("campaign_posts")
    .select("*, campaign!inner(tenant_id)", { count: "exact", head: true })
    .eq("campaign.tenant_id", tenantId)
    .gte("created_at", startOfMonth.toISOString());
  
  if ((count || 0) + postsToCreate > limits.posts) {
    const remaining = limits.posts - (count || 0);
    return { 
      allowed: false, 
      message: `You've reached your monthly post limit (${limits.posts}). You have ${remaining} posts remaining this month.`
    };
  }
  
  return { allowed: true };
}

export async function checkMediaLimit(tenantId: string): Promise<{ allowed: boolean; message?: string }> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier")
    .eq("id", tenantId)
    .single();
  
  if (!tenant) {
    return { allowed: false, message: "Tenant not found" };
  }
  
  const limits = getTierLimits(tenant.subscription_tier ?? 'trial');
  
  // Check if unlimited
  if (limits.mediaAssets === -1) {
    return { allowed: true };
  }
  
  // Count existing media assets
  const { count } = await supabase
    .from("media_assets")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  
  if ((count || 0) >= limits.mediaAssets) {
    return { 
      allowed: false, 
      message: `You've reached your media storage limit (${limits.mediaAssets} images). Upgrade your plan for unlimited storage.`
    };
  }
  
  return { allowed: true };
}

export async function checkTrialExpired(tenantId: string): Promise<boolean> {
  const supabase = await createClient();
  
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_status, trial_ends_at")
    .eq("id", tenantId)
    .single();
  
  if (!tenant) return true;
  
  if (tenant.subscription_status === "trial" && tenant.trial_ends_at) {
    return new Date(tenant.trial_ends_at) < new Date();
  }
  
  return false;
}
