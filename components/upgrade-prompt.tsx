"use client";

import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, TrendingUp, Zap, Clock } from "lucide-react";
import { useEffect, useState } from "react";

interface UpgradePromptProps {
  feature: string;
  benefit: string;
  urgency?: "low" | "medium" | "high";
  currentUsage?: number;
  limit?: number;
  discount?: number;
}

export function UpgradePrompt({ 
  feature, 
  benefit, 
  urgency = "low",
  currentUsage,
  limit,
  discount = 20 
}: UpgradePromptProps) {
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  
  useEffect(() => {
    // Calculate days left in trial
    const checkTrialStatus = async () => {
      try {
        const response = await fetch("/api/subscription/status");
        const data = await response.json();
        if (data.trialEndsAt) {
          const endDate = new Date(data.trialEndsAt);
          const today = new Date();
          const days = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          setDaysLeft(days > 0 ? days : 0);
        }
      } catch (error) {
        console.error("Failed to fetch trial status");
      }
    };
    
    checkTrialStatus();
  }, []);
  
  const getUrgencyStyles = () => {
    switch (urgency) {
      case "high":
        return "bg-error/10 border-error/20 text-error";
      case "medium":
        return "bg-warning/10 border-warning/20 text-warning";
      default:
        return "bg-primary/10 border-primary/20 text-primary";
    }
  };
  
  const getIcon = () => {
    switch (urgency) {
      case "high":
        return <Zap className="size-5" />;
      case "medium":
        return <TrendingUp className="size-5" />;
      default:
        return <Sparkles className="size-5" />;
    }
  };
  
  return (
    <div className={`rounded-medium border p-4 ${getUrgencyStyles()}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{getIcon()}</div>
        <div className="flex-1">
          <p className="mb-1 text-sm font-medium">
            Unlock {feature} with Professional
          </p>
          <p className="mb-3 text-xs text-text-secondary">
            {benefit}
          </p>
          
          {/* Usage indicator */}
          {currentUsage !== undefined && limit !== undefined && (
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-xs">
                <span>{currentUsage} / {limit} used</span>
                <span>{Math.round((currentUsage / limit) * 100)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div 
                  className={`h-2 rounded-full transition-all ${
                    currentUsage >= limit ? 'bg-error' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min((currentUsage / limit) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
          
          {/* Trial countdown */}
          {daysLeft !== null && daysLeft <= 3 && daysLeft > 0 && (
            <div className="mb-3 flex items-center gap-1 text-xs text-warning">
              <Clock className="size-3" />
              <span>Only {daysLeft} days left in trial</span>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Link 
              href="/settings/billing" 
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
            >
              Upgrade Now
              {discount > 0 && (
                <span className="ml-1 text-xs opacity-90">
                  - {discount}% off
                </span>
              )}
            </Link>
            
            {daysLeft === 0 && (
              <button className="text-xs text-text-secondary hover:text-primary">
                Extend trial
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline upgrade nudge for softer prompts
export function UpgradeNudge({ message }: { message: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-soft bg-primary/10 px-3 py-1 text-sm text-primary">
      <Sparkles className="size-4" />
      <span>{message}</span>
      <Link href="/settings/billing" className="font-medium underline">
        Upgrade
      </Link>
    </div>
  );
}

// Modal for when hitting hard limits
export function UpgradeLimitModal({ 
  isOpen, 
  onClose, 
  feature,
  currentUsage,
  limit 
}: {
  isOpen: boolean;
  onClose: () => void;
  feature: string;
  currentUsage: number;
  limit: number;
}) {
  if (!isOpen) return null;
  
  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-w-md flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle className="font-heading text-xl">Limit Reached</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto px-6 py-4 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-warning/10">
            <TrendingUp className="size-8 text-warning" />
          </div>
          
          <h2 className="mb-2 font-heading text-xl font-bold">
            You&apos;ve reached your limit!
          </h2>
          
          <p className="text-text-secondary">
            You&apos;ve used all {limit} {feature} in your free trial.
          </p>
        </div>
        <div className="mx-6 mb-6 rounded-medium bg-background p-4">
          <h3 className="mb-3 text-sm font-medium">Upgrade to unlock:</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="text-success">✓</span>
              Unlimited campaigns
            </li>
            <li className="flex items-center gap-2">
              <span className="text-success">✓</span>
              500 AI posts per month
            </li>
            <li className="flex items-center gap-2">
              <span className="text-success">✓</span>
              Advanced scheduling
            </li>
            <li className="flex items-center gap-2">
              <span className="text-success">✓</span>
              Multiple social accounts
            </li>
          </ul>
        </div>
        
        <div className="flex gap-3 px-6 pb-6">
          <Link 
            href="/settings/billing" 
            className="flex-1 rounded-md bg-primary px-4 py-2 text-center text-white"
          >
            Upgrade Now - Save 20%
          </Link>
          <button 
            onClick={onClose}
            className="rounded-md px-4 py-2 text-text-secondary hover:bg-muted"
          >
            Maybe Later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
