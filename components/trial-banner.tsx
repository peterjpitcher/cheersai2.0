"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle, X, ChevronRight } from "lucide-react";
import Link from "next/link";

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
      .single();

    if (!userData?.tenant) return;

    const { subscription_status, subscription_tier, trial_ends_at } = userData.tenant;

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
    } text-white px-4 py-3`}>
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">
            {isExpired
              ? "Your free trial has expired. Upgrade now to continue using CheersAI."
              : `Your free trial expires in ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}. Upgrade now to keep your campaigns running.`}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <Link 
            href="/billing"
            className="bg-white text-black px-4 py-2 rounded-soft text-sm font-semibold hover:bg-gray-100 transition-colors flex items-center gap-1"
          >
            Upgrade Now
            <ChevronRight className="w-4 h-4" />
          </Link>
          
          {!isExpired && (
            <button
              onClick={() => setShowBanner(false)}
              className="text-white/80 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}