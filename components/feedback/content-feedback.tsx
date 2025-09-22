"use client";

import { useState } from "react";
import {
  AlertTriangle, Check, RefreshCw, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ContentFeedbackProps {
  content: string;
  prompt?: string;
  platform?: string;
  generationType: "campaign" | "quick_post" | "caption" | "hashtags" | "other";
  campaignId?: string;
  postId?: string;
  onFeedbackSubmit?: () => void;
  onRegenerate?: () => void;
  className?: string;
}

export default function ContentFeedback({
  content,
  prompt,
  platform,
  generationType,
  campaignId,
  postId,
  onFeedbackSubmit,
  onRegenerate,
  className = ""
}: ContentFeedbackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Scope: whether this rule applies to this platform only or to all content
  const [scope, setScope] = useState<"platform" | "all">(platform ? "platform" : "all");

  const handleSubmit = async () => {
    if (!feedbackText.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          prompt,
          platform,
          generationType,
          campaignId,
          postId,
          scope,
          feedbackText,
        }),
      });

      if (!resp.ok) {
        const json = await resp.json().catch(() => null);
        throw new Error(json?.error?.message || json?.message || "Feedback submission failed");
      }

      setSubmitted(true);
      setFeedbackText("");
      setIsExpanded(false); // Close the expanded section
      
      // Trigger regeneration if callback provided
      if (onRegenerate) {
        setTimeout(() => {
          onRegenerate();
        }, 1500);
      }

      if (onFeedbackSubmit) onFeedbackSubmit();

      // Reset after showing success
      setTimeout(() => {
        setSubmitted(false);
      }, 4000);

    } catch (err) {
      console.error("Error submitting feedback:", err);
      setError("Failed to submit feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className={`rounded-medium border border-success/20 bg-success/10 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 size-5 text-success" />
          <div className="flex-1">
            <p className="font-medium text-success">Thanks for the feedback!</p>
            <p className="mt-1 text-sm text-text-secondary">
              We've saved this as a guardrail and won't make this mistake again.
              {onRegenerate && " Regenerating content with your feedback..."}
            </p>
          </div>
          {onRegenerate && (
            <RefreshCw className="size-5 animate-spin text-success" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-medium border border-border ${className}`}>
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between rounded-medium px-4 py-3 transition-colors hover:bg-surface"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" />
          <span className="text-sm font-medium">Did we make a mistake?</span>
          {!isExpanded && (
            <span className="text-xs text-text-secondary">Click to report an issue</span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="size-4 text-text-secondary" />
        ) : (
          <ChevronDown className="size-4 text-text-secondary" />
        )}
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="space-y-3 border-t border-border p-4">
          {/* Header with clear messaging */}
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 text-warning" />
            <div className="flex-1">
              <p className="font-medium">Tell us what went wrong</p>
              <p className="text-sm text-text-secondary">
                We'll fix it and make sure it doesn't happen again
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-medium bg-error/10 p-3 text-error">
              <AlertTriangle className="mt-0.5 size-4" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Scope + input */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-text-secondary">
              Applies to:
            </div>
            <div className="inline-flex overflow-hidden rounded-md border border-input">
              <button
                type="button"
                onClick={() => setScope("platform")}
                className={`px-3 py-1.5 text-sm ${scope === "platform" ? "bg-primary text-white" : "bg-background text-text-secondary hover:bg-muted"}`}
                disabled={!platform}
                title={platform ? `Only ${platform} content` : "Channel option unavailable without a platform"}
              >
                {platform ? `This channel only` : "This channel only"}
              </button>
              <button
                type="button"
                onClick={() => setScope("all")}
                className={`px-3 py-1.5 text-sm ${scope === "all" ? "bg-primary text-white" : "bg-background text-text-secondary hover:bg-muted"}`}
              >
                All content
              </button>
            </div>
          </div>

          {/* Single input field */}
          <div>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="E.g., Don't use formal language, avoid mentioning competitors, include our opening hours..."
            className="min-h-[80px] w-full rounded-md border border-input px-3 py-2 text-sm"
              maxLength={500}
              disabled={loading}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {feedbackText.length}/500 characters
            </p>
          </div>

          {/* Submit button */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-secondary">
              Your feedback will be automatically applied to future content
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsExpanded(false);
                  setFeedbackText("");
                  setError(null);
                }}
                className="rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-muted"
              >
                Cancel
              </button>
              <Button onClick={handleSubmit} loading={loading} disabled={!feedbackText.trim()} size="sm">
                {!loading && <Check className="size-4" />}
                Save & Fix
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
