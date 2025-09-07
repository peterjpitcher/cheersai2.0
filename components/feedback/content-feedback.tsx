"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  AlertTriangle, Check, Loader2, RefreshCw, ChevronDown, ChevronUp
} from "lucide-react";

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
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (!userData?.tenant_id) throw new Error("No tenant found");

      // Save feedback
      const { data: feedback, error: feedbackError } = await supabase
        .from("ai_generation_feedback")
        .insert({
          tenant_id: userData.tenant_id,
          user_id: user.id,
          campaign_id: campaignId || null,
          post_id: postId || null,
          generated_content: content,
          prompt_used: prompt || null,
          platform: platform || null,
          generation_type: generationType,
          feedback_type: "needs_improvement",
          feedback_text: feedbackText,
          suggested_improvement: null,
        })
        .select()
        .single();

      if (feedbackError) throw feedbackError;

      // Automatically create guardrail from feedback
      const { data: guardrail, error: guardrailError } = await supabase
        .from("content_guardrails")
        .insert({
          tenant_id: userData.tenant_id,
          user_id: user.id,
          context_type: generationType === "campaign" ? "campaign" : 
                       generationType === "quick_post" ? "quick_post" : "general",
          platform: scope === "platform" ? (platform || null) : null,
          feedback_type: "avoid", // Default to "avoid" for mistake corrections
          feedback_text: feedbackText,
          original_content: content,
          original_prompt: prompt || null,
          is_active: true,
        })
        .select()
        .single();

      if (guardrailError) throw guardrailError;

      // Update feedback with guardrail reference
      if (guardrail && feedback) {
        await supabase
          .from("ai_generation_feedback")
          .update({
            converted_to_guardrail: true,
            guardrail_id: guardrail.id
          })
          .eq("id", feedback.id);
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
      <div className={`bg-success/10 border border-success/20 rounded-medium p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <Check className="w-5 h-5 text-success mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-success">Thanks for the feedback!</p>
            <p className="text-sm text-text-secondary mt-1">
              We've saved this as a guardrail and won't make this mistake again.
              {onRegenerate && " Regenerating content with your feedback..."}
            </p>
          </div>
          {onRegenerate && (
            <RefreshCw className="w-5 h-5 text-success animate-spin" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`border border-border rounded-medium ${className}`}>
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface transition-colors rounded-medium"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <span className="text-sm font-medium">Did we make a mistake?</span>
          {!isExpanded && (
            <span className="text-xs text-text-secondary">Click to report an issue</span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-text-secondary" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-secondary" />
        )}
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="border-t border-border p-4 space-y-3">
          {/* Header with clear messaging */}
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">Tell us what went wrong</p>
              <p className="text-sm text-text-secondary">
                We'll fix it and make sure it doesn't happen again
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-error/10 text-error rounded-medium">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Scope + input */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-text-secondary">
              Applies to:
            </div>
            <div className="inline-flex rounded-md border border-input overflow-hidden">
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
            className="min-h-[80px] text-sm w-full border border-input rounded-md px-3 py-2"
              maxLength={500}
              disabled={loading}
              autoFocus
            />
            <p className="text-xs text-text-secondary mt-1">
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
                className="text-sm text-text-secondary hover:bg-muted rounded-md px-3 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !feedbackText.trim()}
                className="bg-primary text-white rounded-md px-3 py-2 text-sm flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save & Fix
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
