"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PRICING_TIERS } from "@/lib/stripe/config";
import { loadStripe } from "@stripe/stripe-js";
import {
  CreditCard, Check, X, Loader2, ChevronLeft,
  Zap, TrendingUp, Users, Phone
} from "lucide-react";
import Link from "next/link";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

interface Subscription {
  subscription_tier: string;
  subscription_status: string;
  trial_ends_at: string;
  stripe_subscription_id?: string;
}

export default function BillingPage() {
  const router = useRouter();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingTier, setProcessingTier] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [usage, setUsage] = useState({
    campaigns: 0,
    posts: 0,
    mediaAssets: 0,
  });

  useEffect(() => {
    fetchSubscriptionData();
  }, []);

  const fetchSubscriptionData = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Get tenant subscription info
    const { data: userData } = await supabase
      .from("users")
      .select(`
        tenant:tenants (
          subscription_tier,
          subscription_status,
          trial_ends_at,
          stripe_subscription_id
        )
      `)
      .eq("id", user.id)
      .single();

    if (userData?.tenant) {
      setSubscription(userData.tenant);
    }

    // Get usage stats
    const { data: tenantData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (tenantData?.tenant_id) {
      // Count campaigns
      const { count: campaignCount } = await supabase
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantData.tenant_id);

      // Count posts
      const { count: postCount } = await supabase
        .from("campaign_posts")
        .select("*, campaign!inner(tenant_id)", { count: "exact", head: true })
        .eq("campaign.tenant_id", tenantData.tenant_id);

      // Count media assets
      const { count: mediaCount } = await supabase
        .from("media_assets")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantData.tenant_id);

      setUsage({
        campaigns: campaignCount || 0,
        posts: postCount || 0,
        mediaAssets: mediaCount || 0,
      });
    }

    setLoading(false);
  };

  const handleUpgrade = async (tierId: string, tier: any) => {
    // Get the correct price ID based on billing period
    const priceId = billingPeriod === "annual" 
      ? (tier.priceIdAnnual || tier.priceId)
      : (tier.priceIdMonthly || tier.priceId);
      
    if (!priceId) {
      // Handle enterprise tier
      window.location.href = "mailto:enterprise@cheersai.orangejelly.co.uk?subject=Enterprise Plan Inquiry";
      return;
    }

    setProcessingTier(tierId);
    
    try {
      const response = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });

      const { sessionId, error } = await response.json();
      
      if (error) {
        alert(error);
        setProcessingTier(null);
        return;
      }

      const stripe = await stripePromise;
      if (!stripe) {
        alert("Stripe failed to load");
        setProcessingTier(null);
        return;
      }

      const { error: stripeError } = await stripe.redirectToCheckout({ sessionId });
      
      if (stripeError) {
        alert(stripeError.message);
        setProcessingTier(null);
      }
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Failed to start checkout");
      setProcessingTier(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm("Are you sure you want to cancel your subscription?")) return;
    
    setLoading(true);
    try {
      const response = await fetch("/api/stripe/cancel-subscription", {
        method: "POST",
      });

      const { success, error } = await response.json();
      
      if (success) {
        alert("Subscription cancelled successfully");
        fetchSubscriptionData();
      } else {
        alert(error || "Failed to cancel subscription");
      }
    } catch (error) {
      console.error("Cancellation error:", error);
      alert("Failed to cancel subscription");
    }
    setLoading(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const getUsagePercentage = (used: number, limit: number) => {
    if (limit === -1) return 0; // Unlimited
    return Math.min((used / limit) * 100, 100);
  };

  const currentTier = subscription?.subscription_tier || "free";
  const isTrialing = subscription?.subscription_status === "trial";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Billing & Subscription</h1>
                <p className="text-sm text-text-secondary">
                  Manage your plan and billing
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Current Plan */}
        <div className="card mb-8">
          <h2 className="text-xl font-heading font-bold mb-4">Current Plan</h2>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-2xl font-bold capitalize">{currentTier}</p>
              {isTrialing && subscription?.trial_ends_at && (
                <p className="text-sm text-warning mt-1">
                  Trial ends on {formatDate(subscription.trial_ends_at)}
                </p>
              )}
            </div>
            {currentTier !== "free" && !isTrialing && (
              <button
                onClick={handleCancelSubscription}
                className="text-error hover:underline text-sm"
              >
                Cancel Subscription
              </button>
            )}
          </div>

          {/* Usage Stats */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Campaigns</span>
                <span>{usage.campaigns} / {PRICING_TIERS.find(t => t.id === currentTier)?.limits.campaigns || 0}</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all"
                  style={{ 
                    width: `${getUsagePercentage(
                      usage.campaigns, 
                      PRICING_TIERS.find(t => t.id === currentTier)?.limits.campaigns || 0
                    )}%` 
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>AI Posts</span>
                <span>{usage.posts} / {PRICING_TIERS.find(t => t.id === currentTier)?.limits.posts || 0}</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all"
                  style={{ 
                    width: `${getUsagePercentage(
                      usage.posts, 
                      PRICING_TIERS.find(t => t.id === currentTier)?.limits.posts || 0
                    )}%` 
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Media Assets</span>
                <span>
                  {usage.mediaAssets} / {
                    PRICING_TIERS.find(t => t.id === currentTier)?.limits.mediaAssets === -1 
                      ? "Unlimited" 
                      : PRICING_TIERS.find(t => t.id === currentTier)?.limits.mediaAssets || 0
                  }
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all"
                  style={{ 
                    width: `${getUsagePercentage(
                      usage.mediaAssets, 
                      PRICING_TIERS.find(t => t.id === currentTier)?.limits.mediaAssets || 0
                    )}%` 
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Billing Period Toggle */}
        <div className="flex items-center justify-center mb-8">
          <div className="bg-surface rounded-full p-1 flex gap-1">
            <button
              onClick={() => setBillingPeriod("monthly")}
              className={`px-4 py-2 rounded-full transition-colors ${
                billingPeriod === "monthly" 
                  ? "bg-primary text-white" 
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod("annual")}
              className={`px-4 py-2 rounded-full transition-colors ${
                billingPeriod === "annual" 
                  ? "bg-primary text-white" 
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Annual <span className="text-xs ml-1">Save 10%</span>
            </button>
          </div>
        </div>

        {/* Pricing Tiers */}
        <h2 className="text-xl font-heading font-bold mb-6">Available Plans</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`card relative ${
                tier.popular ? "ring-2 ring-primary" : ""
              } ${currentTier === tier.id ? "bg-primary/5" : ""}`}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-white px-3 py-1 rounded-full text-xs font-bold">
                    MOST POPULAR
                  </span>
                </div>
              )}

              {currentTier === tier.id && (
                <div className="absolute -top-3 right-4">
                  <span className="bg-success text-white px-3 py-1 rounded-full text-xs font-bold">
                    CURRENT
                  </span>
                </div>
              )}

              <h3 className="text-lg font-heading font-bold mb-2">{tier.name}</h3>
              <p className="text-sm text-text-secondary mb-4">{tier.description}</p>
              
              <div className="mb-6">
                {tier.price !== null ? (
                  <div className="flex items-baseline">
                    <span className="text-3xl font-bold">
                      £{billingPeriod === "annual" && tier.priceAnnual 
                        ? Math.floor(tier.priceAnnual / 12) 
                        : tier.priceMonthly || tier.price}
                    </span>
                    <span className="text-text-secondary ml-2">/month</span>
                    {billingPeriod === "annual" && tier.priceAnnual && (
                      <span className="text-xs text-success ml-2">
                        (£{tier.priceAnnual}/year)
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-2xl font-bold">Custom Pricing</div>
                )}
              </div>

              <ul className="space-y-2 mb-6">
                {tier.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {currentTier !== tier.id && (
                <button
                  onClick={() => handleUpgrade(tier.id, tier)}
                  disabled={processingTier === tier.id}
                  className={`w-full ${
                    tier.popular ? "btn-primary" : "btn-secondary"
                  }`}
                >
                  {processingTier === tier.id ? (
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  ) : (
                    tier.cta
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}