"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { CreditCard, Check, AlertCircle, ExternalLink } from "lucide-react";
import { getSubscriptionTier, getSubscriptionLimits } from "@/lib/stripe/config";
import { useRouter } from "next/navigation";

interface Subscription {
  id: string;
  tier: string;
  status: string;
  current_period_end: string;
  trial_ends_at: string | null;
}

const plans = [
  {
    name: "Starter",
    tier: "starter",
    price: "£29",
    period: "/month",
    features: [
      "5 campaigns per month",
      "4 social platforms",
      "Basic analytics",
      "Email support",
      "100MB media storage",
    ],
  },
  {
    name: "Professional",
    tier: "professional",
    price: "£44.99",
    period: "/month",
    popular: true,
    features: [
      "20 campaigns per month",
      "All social platforms",
      "Advanced analytics",
      "Priority support",
      "1GB media storage",
      "Team collaboration (3 users)",
      "Custom brand voice",
    ],
  },
  {
    name: "Enterprise",
    tier: "enterprise",
    price: "Custom",
    period: "",
    features: [
      "Unlimited campaigns",
      "All features included",
      "Dedicated support",
      "Unlimited storage",
      "Unlimited team members",
      "API access",
      "Custom integrations",
    ],
  },
];

export default function BillingPage() {
  const router = useRouter();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscription();
  }, []);

  const fetchSubscription = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      setLoading(false);
      return;
    }

    const { data: subData } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (subData) {
      setSubscription(subData);
    }
    setLoading(false);
  };

  const handleUpgrade = async (tier: string) => {
    if (tier === "enterprise") {
      window.location.href = "mailto:sales@cheersai.com?subject=Enterprise Plan Inquiry";
      return;
    }

    setUpgrading(tier);
    
    try {
      const response = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          tier,
          successUrl: window.location.origin + "/settings/billing?success=true",
          cancelUrl: window.location.origin + "/settings/billing",
        }),
      });

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error("Error creating checkout:", error);
      alert("Failed to start checkout. Please try again.");
    } finally {
      setUpgrading(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const response = await fetch("/api/stripe/create-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error("Error creating portal session:", error);
      alert("Failed to open billing portal. Please try again.");
    }
  };

  const isTrialing = subscription?.status === "trialing";
  const currentTier = subscription?.tier || "free";
  const daysLeft = subscription?.trial_ends_at
    ? Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-heading font-bold">Billing & Subscription</h2>
        <p className="text-text-secondary mt-1">
          Manage your subscription and billing information
        </p>
      </div>

      {/* Current Plan */}
      {isTrialing && (
        <div className="bg-primary/10 border border-primary/20 rounded-large p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">Free Trial Active</p>
              <p className="text-sm text-text-secondary mt-1">
                {daysLeft > 0
                  ? `${daysLeft} days remaining in your trial`
                  : "Your trial has expired"}
              </p>
              {daysLeft <= 3 && daysLeft > 0 && (
                <p className="text-sm text-primary mt-2">
                  Upgrade now to ensure uninterrupted service
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {subscription && !isTrialing && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Current Plan</h3>
            <button
              onClick={handleManageSubscription}
              className="btn-ghost flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Manage Subscription
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-medium">
              <CreditCard className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="font-medium capitalize">{currentTier} Plan</p>
              <p className="text-sm text-text-secondary">
                Renews on {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Plans */}
      <div className="grid md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isCurrentPlan = plan.tier === currentTier;
          const isDowngrade = 
            (currentTier === "professional" && plan.tier === "starter") ||
            (currentTier === "enterprise" && plan.tier !== "enterprise");
          
          return (
            <div
              key={plan.tier}
              className={`card p-6 relative ${
                plan.popular ? "ring-2 ring-primary" : ""
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-white px-3 py-1 rounded-full text-xs font-medium">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
                <div className="flex items-baseline">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-text-secondary ml-1">{plan.period}</span>
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              {isCurrentPlan ? (
                <button disabled className="btn-secondary w-full">
                  Current Plan
                </button>
              ) : isDowngrade ? (
                <button
                  onClick={() => handleManageSubscription()}
                  className="btn-ghost w-full"
                >
                  Contact Support
                </button>
              ) : (
                <button
                  onClick={() => handleUpgrade(plan.tier)}
                  disabled={upgrading === plan.tier}
                  className="btn-primary w-full"
                >
                  {upgrading === plan.tier ? "Processing..." : 
                   plan.tier === "enterprise" ? "Contact Sales" : "Upgrade"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment Method */}
      {subscription && !isTrialing && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Payment Method</h3>
          <p className="text-text-secondary mb-4">
            Manage your payment methods and billing details through our secure billing portal.
          </p>
          <button
            onClick={handleManageSubscription}
            className="btn-secondary"
          >
            Manage Payment Methods
          </button>
        </div>
      )}

      {/* Billing History */}
      {subscription && !isTrialing && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Billing History</h3>
          <p className="text-text-secondary mb-4">
            View and download your invoices and receipts.
          </p>
          <button
            onClick={handleManageSubscription}
            className="btn-secondary"
          >
            View Billing History
          </button>
        </div>
      )}

      {/* Support */}
      <div className="card p-6 bg-surface-secondary">
        <h3 className="text-lg font-semibold mb-2">Need Help?</h3>
        <p className="text-text-secondary mb-4">
          Our support team is here to help with billing questions.
        </p>
        <div className="flex gap-4">
          <a
            href="mailto:billing@cheersai.com"
            className="btn-ghost"
          >
            Contact Support
          </a>
          <a
            href="/help"
            className="btn-ghost"
          >
            View FAQ
          </a>
        </div>
      </div>
    </div>
  );
}