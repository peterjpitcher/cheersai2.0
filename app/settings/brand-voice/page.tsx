"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, Loader2,
  CheckCircle, Plus, Trash2,
  Shield, Eye, EyeOff
} from "lucide-react";
import Link from "next/link";

interface Guardrail {
  id: string;
  context_type: string;
  feedback_type: string;
  feedback_text: string;
  is_active: boolean;
  times_applied: number;
  created_at: string;
}

export default function BrandVoicePage() {
  const router = useRouter();
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [brandIdentity, setBrandIdentity] = useState("");
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'identity' | 'guardrails'>('identity');
  const [newGuardrail, setNewGuardrail] = useState("");
  const [guardrailType, setGuardrailType] = useState<'avoid' | 'include' | 'tone' | 'style' | 'format'>('avoid');

  useEffect(() => {
    fetchVoiceData();
  }, []);

  const fetchVoiceData = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Fetch brand profile with identity
    const { data: brandProfile } = await supabase
      .from("brand_profiles")
      .select("brand_identity")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (brandProfile?.brand_identity) {
      setBrandIdentity(brandProfile.brand_identity);
    }


    // Fetch guardrails
    const response = await fetch("/api/guardrails?is_active=true");
    if (response.ok) {
      const { guardrails: guardrailsData } = await response.json();
      setGuardrails(guardrailsData || []);
    }

    setLoading(false);
  };

  const handleSaveIdentity = async () => {
    if (!brandIdentity.trim()) return;
    
    setSavingIdentity(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    const { error } = await supabase
      .from("brand_profiles")
      .update({ brand_identity: brandIdentity })
      .eq("tenant_id", userData.tenant_id);

    if (!error) {
      alert("Brand identity saved successfully!");
    } else {
      alert("Failed to save brand identity");
    }
    
    setSavingIdentity(false);
  };


  const handleAddGuardrail = async () => {
    if (!newGuardrail.trim()) return;

    try {
      const response = await fetch("/api/guardrails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context_type: "general",
          feedback_type: guardrailType,
          feedback_text: newGuardrail,
        }),
      });

      if (response.ok) {
        const { guardrail } = await response.json();
        setGuardrails([guardrail, ...guardrails]);
        setNewGuardrail("");
      }
    } catch (error) {
      console.error("Error adding guardrail:", error);
    }
  };

  const handleToggleGuardrail = async (id: string, isActive: boolean) => {
    try {
      const response = await fetch("/api/guardrails", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          is_active: !isActive,
        }),
      });

      if (response.ok) {
        setGuardrails(guardrails.map(g => 
          g.id === id ? { ...g, is_active: !isActive } : g
        ));
      }
    } catch (error) {
      console.error("Error toggling guardrail:", error);
    }
  };

  const handleDeleteGuardrail = async (id: string) => {
    if (!confirm("Are you sure you want to delete this guardrail?")) return;

    try {
      const response = await fetch(`/api/guardrails?id=${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setGuardrails(guardrails.filter(g => g.id !== id));
      }
    } catch (error) {
      console.error("Error deleting guardrail:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-heading font-bold">Brand Voice & Guardrails</h1>
                <p className="text-sm text-text-secondary">
                  Define your brand identity and content guardrails
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">

        {/* Tab Navigation */}
        <div className="flex gap-4 mb-6 border-b border-border">
          <button
            onClick={() => setActiveTab('identity')}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === 'identity'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            Brand Identity
          </button>
          <button
            onClick={() => setActiveTab('guardrails')}
            className={`pb-3 px-1 font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'guardrails'
                ? 'text-primary border-b-2 border-primary'
                : 'text-text-secondary hover:text-primary'
            }`}
          >
            <Shield className="w-4 h-4" />
            Content Guardrails
            {guardrails.length > 0 && (
              <span className="badge-primary text-xs">{guardrails.length}</span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'identity' ? (
          <div className="card">
            <h3 className="font-semibold mb-4">Your Brand Identity</h3>
            <p className="text-sm text-text-secondary mb-6">
              This is your brand's core identity - who you are, what you stand for, and what makes you unique. 
              AI will use this to generate authentic, on-brand content.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Brand Identity Statement
                </label>
                <textarea
                  value={brandIdentity}
                  onChange={(e) => setBrandIdentity(e.target.value)}
                  className="input-field min-h-[200px] w-full"
                  placeholder="Describe your pub's unique identity, history, values, and what makes you special..."
                  maxLength={1000}
                />
                <p className="text-xs text-text-secondary mt-2">
                  {brandIdentity.length}/1000 characters
                </p>
              </div>

              {/* Helper Tips */}
              <div className="bg-primary/5 border border-primary/20 rounded-medium p-4">
                <p className="text-sm font-medium mb-3">Tips for a strong brand identity:</p>
                <ul className="space-y-1 text-sm text-text-secondary">
                  <li>• Include your founding story and history</li>
                  <li>• Describe what makes you different from other pubs</li>
                  <li>• Mention your core values and beliefs</li>
                  <li>• Explain the experience customers can expect</li>
                  <li>• Highlight your role in the community</li>
                </ul>
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveIdentity}
                  disabled={savingIdentity || !brandIdentity.trim()}
                  className="btn-primary flex items-center gap-2"
                >
                  {savingIdentity ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Save Identity
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Guardrails Section */}
            <div className="card mb-6">
              <div className="flex items-start gap-3 mb-4">
                <Shield className="w-5 h-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold">Content Guardrails</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    Set rules and preferences for AI-generated content to ensure it matches your brand standards
                  </p>
                </div>
              </div>

              {/* Add Guardrail Form */}
              <div className="space-y-4 p-4 bg-surface rounded-medium">
                <div className="flex gap-2">
                  <select
                    value={guardrailType}
                    onChange={(e) => setGuardrailType(e.target.value as any)}
                    className="input-field"
                  >
                    <option value="avoid">Things to Avoid</option>
                    <option value="include">Things to Include</option>
                    <option value="tone">Tone Preference</option>
                    <option value="style">Style Preference</option>
                    <option value="format">Format Preference</option>
                  </select>
                </div>

                <textarea
                  value={newGuardrail}
                  onChange={(e) => setNewGuardrail(e.target.value)}
                  placeholder={
                    guardrailType === 'avoid' ? "E.g., Avoid using corporate jargon or overly formal language..." :
                    guardrailType === 'include' ? "E.g., Always mention our happy hour specials on Fridays..." :
                    guardrailType === 'tone' ? "E.g., Keep the tone friendly and conversational, not too formal..." :
                    guardrailType === 'style' ? "E.g., Use short, punchy sentences with occasional emojis..." :
                    "E.g., Keep Instagram captions under 125 characters..."
                  }
                  className="input-field min-h-24"
                  maxLength={500}
                />

                <div className="flex justify-between items-center">
                  <p className="text-sm text-text-secondary">
                    {newGuardrail.length}/500 characters
                  </p>
                  <button
                    onClick={handleAddGuardrail}
                    disabled={!newGuardrail.trim()}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Guardrail
                  </button>
                </div>
              </div>
            </div>

            {/* Guardrails List */}
            <div className="card">
              <h3 className="font-semibold mb-4">
                Active Guardrails ({guardrails.filter(g => g.is_active).length})
              </h3>

              {guardrails.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                  <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No guardrails set yet</p>
                  <p className="text-sm mt-1">Add guardrails to guide AI content generation</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {guardrails.map((guardrail) => (
                    <div
                      key={guardrail.id}
                      className={`p-4 rounded-medium border ${
                        guardrail.is_active
                          ? 'bg-white border-border'
                          : 'bg-gray-50 border-gray-200 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`badge-${
                            guardrail.feedback_type === 'avoid' ? 'error' :
                            guardrail.feedback_type === 'include' ? 'success' :
                            'primary'
                          } text-xs`}>
                            {guardrail.feedback_type}
                          </span>
                          {guardrail.times_applied > 0 && (
                            <span className="text-xs text-text-secondary">
                              Used {guardrail.times_applied} times
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleGuardrail(guardrail.id, guardrail.is_active)}
                            className="p-1 hover:bg-surface rounded-soft"
                            title={guardrail.is_active ? "Disable" : "Enable"}
                          >
                            {guardrail.is_active ? (
                              <Eye className="w-4 h-4 text-success" />
                            ) : (
                              <EyeOff className="w-4 h-4 text-text-secondary" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteGuardrail(guardrail.id)}
                            className="p-1 hover:bg-error/10 rounded-soft"
                          >
                            <Trash2 className="w-4 h-4 text-error" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-text-primary">
                        {guardrail.feedback_text}
                      </p>
                      <p className="text-xs text-text-secondary mt-2">
                        Added {new Date(guardrail.created_at).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Guardrails Info */}
            <div className="mt-6 p-4 bg-primary/5 rounded-medium">
              <h4 className="font-semibold text-sm mb-2">How Guardrails Work</h4>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• Guardrails are automatically applied when generating content</li>
                <li>• "Avoid" rules prevent unwanted language or topics</li>
                <li>• "Include" rules ensure important information is mentioned</li>
                <li>• You can disable guardrails temporarily without deleting them</li>
                <li>• Guardrails improve over time as you provide more feedback</li>
              </ul>
            </div>
          </>
        )}
      </main>
    </div>
  );
}