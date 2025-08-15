import { createClient } from "@/lib/supabase/server";
import { getTierLimits } from "@/lib/stripe/config";

export interface LimitCheckResult {
  allowed: boolean;
  message?: string;
  showUpgrade?: boolean;
  currentUsage?: number;
  limit?: number;
}

export async function checkCampaignLimit(tenantId: string): Promise<LimitCheckResult> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier, trial_ends_at")
    .eq("id", tenantId)
    .single();
    
  if (!tenant) {
    return { allowed: false, message: "Tenant not found" };
  }
  
  const limits = getTierLimits(tenant.subscription_tier || "free");
  
  // If unlimited (-1), always allow
  if (limits.campaigns === -1) {
    return { allowed: true };
  }
  
  // Count existing campaigns
  const { count } = await supabase
    .from("campaigns")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
    
  const currentUsage = count || 0;
  
  if (currentUsage >= limits.campaigns) {
    // Check if trial is expired
    const trialExpired = tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date();
    
    return {
      allowed: false,
      message: trialExpired 
        ? "Your free trial has ended. Upgrade to continue creating campaigns!"
        : `You've reached your limit of ${limits.campaigns} campaigns. Upgrade for unlimited campaigns!`,
      showUpgrade: true,
      currentUsage,
      limit: limits.campaigns
    };
  }
  
  return { 
    allowed: true, 
    currentUsage, 
    limit: limits.campaigns 
  };
}

export async function checkPostLimit(tenantId: string): Promise<LimitCheckResult> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier")
    .eq("id", tenantId)
    .single();
    
  const limits = getTierLimits(tenant?.subscription_tier || "free");
  
  if (limits.posts === -1) {
    return { allowed: true };
  }
  
  // Count posts in current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const { count } = await supabase
    .from("campaign_posts")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", startOfMonth.toISOString());
    
  const currentUsage = count || 0;
  
  if (currentUsage >= limits.posts) {
    return {
      allowed: false,
      message: `You've used all ${limits.posts} AI posts this month. Upgrade for more!`,
      showUpgrade: true,
      currentUsage,
      limit: limits.posts
    };
  }
  
  return { 
    allowed: true, 
    currentUsage, 
    limit: limits.posts 
  };
}

export async function checkSocialAccountLimit(tenantId: string): Promise<LimitCheckResult> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier")
    .eq("id", tenantId)
    .single();
    
  const limits = getTierLimits(tenant?.subscription_tier || "free");
  
  // Check if this tier has social account limits
  if (!limits.socialAccounts || limits.socialAccounts === -1) {
    return { allowed: true };
  }
  
  // Count connected social accounts
  const { count } = await supabase
    .from("social_connections")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
    
  const currentUsage = count || 0;
  
  if (currentUsage >= limits.socialAccounts) {
    return {
      allowed: false,
      message: `Free trial allows only ${limits.socialAccounts} social account. Upgrade to connect more!`,
      showUpgrade: true,
      currentUsage,
      limit: limits.socialAccounts
    };
  }
  
  return { 
    allowed: true, 
    currentUsage, 
    limit: limits.socialAccounts 
  };
}

export async function checkSchedulingPermission(tenantId: string): Promise<LimitCheckResult> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier")
    .eq("id", tenantId)
    .single();
    
  const limits = getTierLimits(tenant?.subscription_tier || "free");
  
  // Check if scheduling is allowed
  if (limits.scheduling === false) {
    return {
      allowed: false,
      message: "Post scheduling is a premium feature. Upgrade to schedule posts!",
      showUpgrade: true
    };
  }
  
  return { allowed: true };
}

export async function checkMediaLimit(tenantId: string): Promise<LimitCheckResult> {
  const supabase = await createClient();
  
  // Get tenant's subscription tier
  const { data: tenant } = await supabase
    .from("tenants")
    .select("subscription_tier")
    .eq("id", tenantId)
    .single();
    
  const limits = getTierLimits(tenant?.subscription_tier || "free");
  
  if (limits.mediaAssets === -1) {
    return { allowed: true };
  }
  
  // Count existing media assets
  const { count } = await supabase
    .from("media_assets")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
    
  const currentUsage = count || 0;
  
  if (currentUsage >= limits.mediaAssets) {
    return {
      allowed: false,
      message: `You've reached your limit of ${limits.mediaAssets} images. Upgrade for unlimited storage!`,
      showUpgrade: true,
      currentUsage,
      limit: limits.mediaAssets
    };
  }
  
  return { 
    allowed: true, 
    currentUsage, 
    limit: limits.mediaAssets 
  };
}