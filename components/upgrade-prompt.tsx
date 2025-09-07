"use client";

import Link from "next/link";
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
        return <Zap className="w-5 h-5" />;
      case "medium":
        return <TrendingUp className="w-5 h-5" />;
      default:
        return <Sparkles className="w-5 h-5" />;
    }
  };
  
  return (
    <div className={`rounded-medium p-4 border ${getUrgencyStyles()}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{getIcon()}</div>
        <div className="flex-1">
          <p className="font-medium text-sm mb-1">
            Unlock {feature} with Pro
          </p>
          <p className="text-xs text-text-secondary mb-3">
            {benefit}
          </p>
          
          {/* Usage indicator */}
          {currentUsage !== undefined && limit !== undefined && (
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span>{currentUsage} / {limit} used</span>
                <span>{Math.round((currentUsage / limit) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
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
            <div className="flex items-center gap-1 text-xs text-warning mb-3">
              <Clock className="w-3 h-3" />
              <span>Only {daysLeft} days left in trial</span>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Link 
              href="/settings/billing" 
            className="text-sm py-2 px-4 bg-primary text-white rounded-md"
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
    <div className="inline-flex items-center gap-2 text-sm text-primary bg-primary/10 px-3 py-1 rounded-soft">
      <Sparkles className="w-4 h-4" />
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-large max-w-md w-full p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-8 h-8 text-warning" />
          </div>
          
          <h2 className="text-xl font-heading font-bold mb-2">
            You&apos;ve reached your limit!
          </h2>
          
          <p className="text-text-secondary">
            You&apos;ve used all {limit} {feature} in your free trial.
          </p>
        </div>
        
        <div className="bg-background rounded-medium p-4 mb-6">
          <h3 className="font-medium text-sm mb-3">Upgrade to unlock:</h3>
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
        
        <div className="flex gap-3">
          <Link 
            href="/settings/billing" 
            className="bg-primary text-white rounded-md py-2 px-4 flex-1 text-center"
          >
            Upgrade Now - Save 20%
          </Link>
          <button 
            onClick={onClose}
            className="text-text-secondary hover:bg-muted rounded-md py-2 px-4"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}
