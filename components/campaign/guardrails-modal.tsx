"use client";

import { useState } from "react";
import { Shield, Plus, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

interface GuardrailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  platform: string;
  content: string;
  existingGuardrails?: string[];
}

const DEFAULT_GUARDRAILS = {
  facebook: [
    "No political content",
    "Family-friendly language only",
    "No competitor mentions",
    "Include call-to-action",
    "Use positive tone"
  ],
  instagram_business: [
    "Include relevant hashtags (5-10)",
    "No links in caption",
    "Emoji-friendly",
    "Visual description for accessibility",
    "Brand voice consistency"
  ],
  twitter: [
    "Keep under 280 characters",
    "No excessive hashtags (max 2-3)",
    "Thread-friendly format",
    "Avoid controversial topics",
    "Include visuals when possible"
  ],
  google_my_business: [
    "Local focus required",
    "Include business hours if relevant",
    "No promotional language",
    "Accurate information only",
    "Respond to reviews professionally"
  ]
};

export default function GuardrailsModal({
  isOpen,
  onClose,
  postId,
  platform,
  content,
  existingGuardrails = []
}: GuardrailsModalProps) {
  const [guardrails, setGuardrails] = useState<string[]>(existingGuardrails);
  const [newGuardrail, setNewGuardrail] = useState("");
  const [saving, setSaving] = useState(false);
  const [violations, setViolations] = useState<string[]>([]);

  // Get platform-specific suggestions
  const suggestions = DEFAULT_GUARDRAILS[platform as keyof typeof DEFAULT_GUARDRAILS] || DEFAULT_GUARDRAILS.facebook;
  const unusedSuggestions = suggestions.filter(s => !guardrails.includes(s));

  const addGuardrail = (rule: string) => {
    if (rule && !guardrails.includes(rule)) {
      setGuardrails([...guardrails, rule]);
    }
    setNewGuardrail("");
  };

  const removeGuardrail = (index: number) => {
    setGuardrails(guardrails.filter((_, i) => i !== index));
  };

  const checkViolations = () => {
    const foundViolations: string[] = [];
    
    // Check character limit for Twitter
    if (platform === "twitter" && content.length > 280) {
      foundViolations.push("Exceeds 280 character limit");
    }
    
    // Check for hashtags
    const hashtagCount = (content.match(/#/g) || []).length;
    if (guardrails.includes("No excessive hashtags (max 2-3)") && hashtagCount > 3) {
      foundViolations.push("Too many hashtags");
    }
    
    // Check for links in Instagram
    if (platform === "instagram_business" && guardrails.includes("No links in caption")) {
      if (content.includes("http://") || content.includes("https://")) {
        foundViolations.push("Contains links (not clickable on Instagram)");
      }
    }
    
    setViolations(foundViolations);
  };

  const saveGuardrails = async () => {
    setSaving(true);
    const supabase = createClient();
    
    try {
      // Save guardrails to post metadata
      const { error } = await supabase
        .from("campaign_posts")
        .update({
          metadata: {
            guardrails,
            last_checked: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", postId);
      
      if (!error) {
        checkViolations();
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save guardrails:", error);
    }
    
    setSaving(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Content Guardrails
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Current Content Preview */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-600 mb-1">Current Content:</p>
            <p className="text-sm">{content.substring(0, 200)}...</p>
            <p className="text-xs text-gray-500 mt-2">{content.length} characters</p>
          </div>

          {/* Violations Warning */}
          {violations.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900">Potential Issues:</p>
                  <ul className="text-xs text-amber-800 mt-1 space-y-0.5">
                    {violations.map((v, i) => (
                      <li key={i}>• {v}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Active Guardrails */}
          <div>
            <h3 className="text-sm font-medium mb-2">Active Guardrails</h3>
            {guardrails.length === 0 ? (
              <p className="text-sm text-gray-500">No guardrails set. Add some below.</p>
            ) : (
              <div className="space-y-2">
                {guardrails.map((rule, index) => (
                  <div key={index} className="flex items-center justify-between bg-white border rounded-lg p-2">
                    <span className="text-sm">{rule}</span>
                    <button
                      onClick={() => removeGuardrail(index)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Custom Guardrail */}
          <div>
            <h3 className="text-sm font-medium mb-2">Add Custom Rule</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newGuardrail}
                onChange={(e) => setNewGuardrail(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addGuardrail(newGuardrail)}
                placeholder="Enter a custom guardrail..."
                className="flex-1 px-3 py-2 border rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <button
                onClick={() => addGuardrail(newGuardrail)}
                disabled={!newGuardrail}
                className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Suggested Guardrails */}
          {unusedSuggestions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Suggested for {platform}</h3>
              <div className="flex flex-wrap gap-2">
                {unusedSuggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => addGuardrail(suggestion)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-sm rounded-full transition-colors"
                  >
                    <Plus className="w-3 h-3 inline mr-1" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <button
            onClick={checkViolations}
            className="text-sm text-primary hover:underline"
          >
            Check for violations
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={saveGuardrails} loading={saving} disabled={guardrails.length === 0} size="sm">
              Save {guardrails.length} Guardrails
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
