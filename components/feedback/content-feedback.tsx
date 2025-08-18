"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  ThumbsUp, ThumbsDown, MessageSquare, X, Check, 
  AlertCircle, Loader2, ChevronDown, ChevronUp 
} from "lucide-react";

interface ContentFeedbackProps {
  content: string;
  prompt?: string;
  platform?: string;
  generationType: "campaign" | "quick_post" | "caption" | "hashtags" | "other";
  campaignId?: string;
  postId?: string;
  onFeedbackSubmit?: () => void;
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
  className = ""
}: ContentFeedbackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"positive" | "negative" | "needs_improvement" | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [suggestedImprovement, setSuggestedImprovement] = useState("");
  const [createGuardrail, setCreateGuardrail] = useState(false);
  const [guardrailType, setGuardrailType] = useState<"avoid" | "include" | "tone" | "style" | "format">("avoid");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!feedbackType) return;

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
          feedback_type: feedbackType,
          feedback_text: feedbackText || null,
          suggested_improvement: suggestedImprovement || null,
        })
        .select()
        .single();

      if (feedbackError) throw feedbackError;

      // Create guardrail if requested
      if (createGuardrail && feedbackText) {
        const { data: guardrail, error: guardrailError } = await supabase
          .from("content_guardrails")
          .insert({
            tenant_id: userData.tenant_id,
            user_id: user.id,
            context_type: generationType === "campaign" ? "campaign" : 
                         generationType === "quick_post" ? "quick_post" : "general",
            platform: platform || null,
            feedback_type: guardrailType,
            feedback_text: feedbackText,
            original_content: content,
            original_prompt: prompt || null,
            is_active: true,
          })
          .select()
          .single();

        if (guardrailError) throw guardrailError;

        // Update feedback with guardrail reference
        if (guardrail) {
          await supabase
            .from("ai_generation_feedback")
            .update({
              converted_to_guardrail: true,
              guardrail_id: guardrail.id
            })
            .eq("id", feedback.id);
        }
      }

      setSubmitted(true);
      if (onFeedbackSubmit) onFeedbackSubmit();

      // Reset after 3 seconds
      setTimeout(() => {
        setSubmitted(false);
        setIsExpanded(false);
        setFeedbackType(null);
        setFeedbackText("");
        setSuggestedImprovement("");
        setCreateGuardrail(false);
      }, 3000);

    } catch (err) {
      console.error("Error submitting feedback:", err);
      setError("Failed to submit feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFeedback = async (type: "positive" | "negative") => {
    setFeedbackType(type);
    if (type === "positive") {
      // Submit positive feedback immediately
      setLoading(true);
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

        await supabase
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
            feedback_type: "positive",
          });

        setSubmitted(true);
        setTimeout(() => {
          setSubmitted(false);
          setFeedbackType(null);
        }, 2000);
      } catch (err) {
        console.error("Error submitting positive feedback:", err);
      } finally {
        setLoading(false);
      }
    } else {
      // Expand for negative feedback details
      setIsExpanded(true);
    }
  };

  if (submitted) {
    return (
      <div className={`flex items-center gap-2 text-success bg-success/10 px-3 py-2 rounded-medium ${className}`}>
        <Check className="w-4 h-4" />
        <span className="text-sm">Thank you for your feedback!</span>
      </div>
    );
  }

  return (
    <div className={`border border-border rounded-medium ${className}`}>
      {/* Quick feedback buttons */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Was this helpful?</span>
          <button
            onClick={() => handleQuickFeedback("positive")}
            disabled={loading}
            className={`p-2 rounded-medium transition-colors ${
              feedbackType === "positive" 
                ? "bg-success/10 text-success" 
                : "hover:bg-surface text-text-secondary"
            }`}
            title="Good content"
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleQuickFeedback("negative")}
            disabled={loading}
            className={`p-2 rounded-medium transition-colors ${
              feedbackType === "negative" 
                ? "bg-error/10 text-error" 
                : "hover:bg-surface text-text-secondary"
            }`}
            title="Needs improvement"
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setFeedbackType("needs_improvement");
              setIsExpanded(!isExpanded);
            }}
            disabled={loading}
            className={`p-2 rounded-medium transition-colors ${
              feedbackType === "needs_improvement" 
                ? "bg-warning/10 text-warning" 
                : "hover:bg-surface text-text-secondary"
            }`}
            title="Provide detailed feedback"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
        
        {!isExpanded && feedbackType && feedbackType !== "positive" && (
          <button
            onClick={() => setIsExpanded(true)}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            Add details
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
        
        {isExpanded && (
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 hover:bg-surface rounded-medium"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Expanded feedback form */}
      {isExpanded && (
        <div className="border-t border-border p-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-error/10 text-error rounded-medium">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">
              What could be improved?
            </label>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="E.g., Too formal, missing key information, wrong tone..."
              className="input-field min-h-[80px] text-sm"
              maxLength={500}
            />
            <p className="text-xs text-text-secondary mt-1">
              {feedbackText.length}/500 characters
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Suggested improvement (optional)
            </label>
            <textarea
              value={suggestedImprovement}
              onChange={(e) => setSuggestedImprovement(e.target.value)}
              placeholder="How would you write it instead?"
              className="input-field min-h-[60px] text-sm"
              maxLength={500}
            />
          </div>

          {/* Create guardrail option */}
          <div className="bg-surface rounded-medium p-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={createGuardrail}
                onChange={(e) => setCreateGuardrail(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">Save as guardrail</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  Apply this feedback to future content generation
                </p>
              </div>
            </label>

            {createGuardrail && (
              <div className="mt-3 pl-6">
                <label className="block text-xs font-medium mb-1">
                  Guardrail type
                </label>
                <select
                  value={guardrailType}
                  onChange={(e) => setGuardrailType(e.target.value as any)}
                  className="input-field text-sm"
                >
                  <option value="avoid">Things to avoid</option>
                  <option value="include">Things to include</option>
                  <option value="tone">Tone preference</option>
                  <option value="style">Style preference</option>
                  <option value="format">Format preference</option>
                </select>
              </div>
            )}
          </div>

          {/* Submit buttons */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => {
                setIsExpanded(false);
                setFeedbackType(null);
                setFeedbackText("");
                setSuggestedImprovement("");
                setCreateGuardrail(false);
              }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !feedbackText.trim()}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Submit Feedback
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}