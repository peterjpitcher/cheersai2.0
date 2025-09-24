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
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            Content Guardrails
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-6">
          {/* Current Content Preview */}
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="mb-1 text-xs font-medium text-gray-600">Current Content:</p>
            <p className="text-sm">{content.substring(0, 200)}...</p>
            <p className="mt-2 text-xs text-gray-500">{`${content.length} characters`}</p>
          </div>

          {/* Violations Warning */}
          {violations.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
                <div>
                  <p className="text-sm font-medium text-amber-900">Potential Issues:</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
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
            <h3 className="mb-2 text-sm font-medium">Active Guardrails</h3>
            {guardrails.length === 0 ? (
              <p className="text-sm text-gray-500">No guardrails set. Add some below.</p>
            ) : (
              <div className="space-y-2">
                {guardrails.map((rule, index) => (
                  <div key={index} className="flex items-center justify-between rounded-lg border bg-white p-2">
                    <span className="text-sm">{rule}</span>
                    <button
                      onClick={() => removeGuardrail(index)}
                      className="text-gray-400 transition-colors hover:text-red-500"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Custom Guardrail */}
          <div>
            <h3 className="mb-2 text-sm font-medium">Add Custom Rule</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newGuardrail}
                onChange={(e) => setNewGuardrail(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addGuardrail(newGuardrail)}
                placeholder="Enter a custom guardrail..."
                className="flex-1 rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <button
                onClick={() => addGuardrail(newGuardrail)}
                disabled={!newGuardrail}
                className="rounded-lg bg-primary px-3 py-2 text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          {/* Suggested Guardrails */}
          {unusedSuggestions.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Suggested for {platform}</h3>
              <div className="flex flex-wrap gap-2">
                {unusedSuggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => addGuardrail(suggestion)}
                    className="rounded-full bg-gray-100 px-3 py-1.5 text-sm transition-colors hover:bg-gray-200"
                  >
                    <Plus className="mr-1 inline size-3" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-4">
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
