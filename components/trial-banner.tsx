"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle, X, ChevronRight } from "lucide-react";
import Link from "next/link";
import Container from "@/components/layout/container";

type TenantSubscription = {
  subscription_status: string | null
  subscription_tier: string | null
  trial_ends_at: string | null
}

type UserWithTenant = {
  tenant: TenantSubscription | TenantSubscription[] | null
}

export default function TrialBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    checkTrialStatus();
  }, []);

  const checkTrialStatus = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select(`
        tenant:tenants (
          subscription_status,
          subscription_tier,
          trial_ends_at
        )
      `)
      .eq("id", user.id)
      .single<UserWithTenant>();

    const tenantRecord = Array.isArray(userData?.tenant) ? userData?.tenant[0] : userData?.tenant;
    if (!tenantRecord) return;

    const { subscription_status, subscription_tier, trial_ends_at } = tenantRecord;

    if (subscription_status === "trial" && trial_ends_at) {
      const trialEnd = new Date(trial_ends_at);
      const now = new Date();
      const days = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (days <= 0) {
        setIsExpired(true);
        setShowBanner(true);
      } else if (days <= 3) {
        setDaysRemaining(days);
        setShowBanner(true);
      }
    } else if (subscription_tier === "free" && subscription_status !== "active") {
      // Check if trial has ended without upgrading
      setIsExpired(true);
      setShowBanner(true);
    }
  };

  if (!showBanner) return null;

  return (
    <div className={`${
      isExpired ? "bg-error" : "bg-warning"
    } px-4 py-3 text-white`}>
      <Container className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="text-sm font-medium">
            {isExpired
              ? "Your free trial has expired. Upgrade now to continue using CheersAI."
              : `Your free trial expires in ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}. Upgrade now to keep your campaigns running.`}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <Link 
            href="/settings/billing"
            className="flex items-center gap-1 rounded-soft bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-100"
          >
            Upgrade Now
            <ChevronRight className="size-4" />
          </Link>
          
          {!isExpired && (
            <button
              onClick={() => setShowBanner(false)}
              className="text-white/80 transition-colors hover:text-white"
            >
              <X className="size-5" />
            </button>
          )}
        </div>
      </Container>
    </div>
  );
}
