"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PRICING_TIERS } from "@/lib/stripe/config";
import { loadStripe } from "@stripe/stripe-js";
import {
  User, Building, Palette, CreditCard, LogOut,
  ChevronRight, Save, Loader2, ChevronLeft, Bell, Shield, Link2, Clock, Image,
  Plus, Trash2, Eye, EyeOff, CheckCircle, Check, X, Zap, TrendingUp, Users, Phone
} from "lucide-react";
import Link from "next/link";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

const TONE_ATTRIBUTES = [
  "Friendly", "Professional", "Witty", "Traditional",
  "Modern", "Casual", "Upbeat", "Sophisticated"
];

interface UserData {
  full_name: string;
  email: string;
  tenant: {
    name: string;
    subscription_status: string;
    subscription_tier: string;
  };
}

interface BrandProfile {
  business_type: string;
  tone_attributes: string[];
  target_audience: string;
  brand_identity?: string;
}

interface Guardrail {
  id: string;
  context_type: string;
  feedback_type: string;
  feedback_text: string;
  is_active: boolean;
  times_applied: number;
  created_at: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("account");
  const [userData, setUserData] = useState<UserData | null>(null);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  
  // Form states
  const [fullName, setFullName] = useState("");
  const [pubName, setPubName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [toneAttributes, setToneAttributes] = useState<string[]>([]);
  const [targetAudience, setTargetAudience] = useState("");
  
  // Voice & Guardrails states
  const [brandIdentity, setBrandIdentity] = useState("");
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [newGuardrail, setNewGuardrail] = useState("");
  const [guardrailType, setGuardrailType] = useState<'avoid' | 'include' | 'tone' | 'style' | 'format'>('avoid');
  const [voiceSubTab, setVoiceSubTab] = useState<'identity' | 'guardrails'>('identity');
  
  // Billing states
  const [processingTier, setProcessingTier] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [usage, setUsage] = useState({
    campaigns: 0,
    posts: 0,
    mediaAssets: 0,
  });

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Get user and tenant data
    const { data } = await supabase
      .from("users")
      .select(`
        full_name,
        is_superadmin,
        tenant:tenants (
          id,
          name,
          subscription_status,
          subscription_tier
        )
      `)
      .eq("id", user.id)
      .single();
      
    if (data?.is_superadmin) {
      setIsSuperadmin(true);
    }

    if (data) {
      setUserData({
        ...data,
        email: user.email || "",
        tenant: data.tenant,
      });
      setFullName(data.full_name || "");
      setPubName(data.tenant.name || "");

      // Get brand profile
      const { data: brand } = await supabase
        .from("brand_profiles")
        .select("*")
        .eq("tenant_id", data.tenant.id)
        .single();

      if (brand) {
        setBrandProfile(brand);
        setBusinessType(brand.business_type || "");
        setToneAttributes(brand.tone_attributes || []);
        setTargetAudience(brand.target_audience || "");
        setBrandIdentity(brand.brand_identity || "");
      }
    }

    // Fetch guardrails
    try {
      const response = await fetch("/api/guardrails?is_active=true");
      if (response.ok) {
        const { guardrails: guardrailsData } = await response.json();
        setGuardrails(guardrailsData || []);
      }
    } catch (error) {
      console.error("Error fetching guardrails:", error);
    }

    // Fetch usage stats for billing
    if (data?.tenant?.id) {
      // Count campaigns
      const { count: campaignCount } = await supabase
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", data.tenant.id);

      // Count posts
      const { count: postCount } = await supabase
        .from("campaign_posts")
        .select("*, campaign!inner(tenant_id)", { count: "exact", head: true })
        .eq("campaign.tenant_id", data.tenant.id);

      // Count media assets
      const { count: mediaCount } = await supabase
        .from("media_assets")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", data.tenant.id);

      setUsage({
        campaigns: campaignCount || 0,
        posts: postCount || 0,
        mediaAssets: mediaCount || 0,
      });
    }

    setLoading(false);
  };

  const handleSaveAccount = async () => {
    setSaving(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Update user name
    await supabase
      .from("users")
      .update({ full_name: fullName })
      .eq("id", user.id);

    // Update tenant name
    if (userData?.tenant) {
      await supabase
        .from("tenants")
        .update({ name: pubName })
        .eq("id", userData.tenant.id);
    }

    setSaving(false);
    alert("Account settings saved!");
  };

  const handleSaveBrand = async () => {
    setSaving(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (userData?.tenant_id) {
      await supabase
        .from("brand_profiles")
        .upsert({
          tenant_id: userData.tenant_id,
          business_type: businessType,
          tone_attributes: toneAttributes,
          target_audience: targetAudience,
          brand_identity: brandIdentity,
        });
    }

    setSaving(false);
    alert("Brand settings saved!");
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

  const handleToneToggle = (tone: string) => {
    if (toneAttributes.includes(tone)) {
      setToneAttributes(toneAttributes.filter(t => t !== tone));
    } else if (toneAttributes.length < 3) {
      setToneAttributes([...toneAttributes, tone]);
    }
  };

  const handleUpgrade = async (tierName: string) => {
    setProcessingTier(tierName);
    try {
      const response = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: tierName,
          billingPeriod,
        }),
      });

      const { sessionId, error } = await response.json();
      
      if (error) {
        alert(error);
        setProcessingTier(null);
        return;
      }

      const stripe = await stripePromise;
      if (!stripe) {
        alert("Failed to load payment system");
        setProcessingTier(null);
        return;
      }

      const { error: stripeError } = await stripe.redirectToCheckout({
        sessionId,
      });

      if (stripeError) {
        alert(stripeError.message);
      }
    } catch (error) {
      alert("Failed to start checkout process");
    } finally {
      setProcessingTier(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm("Are you sure you want to cancel your subscription? You'll lose access to premium features at the end of your billing period.")) {
      return;
    }

    try {
      const response = await fetch("/api/stripe/cancel-subscription", {
        method: "POST",
      });

      const { success, error } = await response.json();
      
      if (error) {
        alert(error);
        return;
      }

      if (success) {
        alert("Your subscription has been cancelled. You'll continue to have access until the end of your billing period.");
        fetchUserData();
      }
    } catch (error) {
      alert("Failed to cancel subscription");
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
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
              <Link href="/dashboard" className="text-text-secondary hover:text-primary">
                <ChevronLeft className="w-6 h-6" />
              </Link>
              <h1 className="text-2xl font-heading font-bold">Settings</h1>
            </div>
            <button onClick={handleLogout} className="btn-ghost text-error">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="grid md:grid-cols-4 gap-8">
          {/* Sidebar Navigation */}
          <div className="md:col-span-1">
            <nav className="space-y-2">
              {isSuperadmin && (
                <Link
                  href="/admin/dashboard"
                  className="w-full text-left px-4 py-3 rounded-medium flex items-center justify-between bg-warning/10 text-warning hover:bg-warning/20 transition-colors mb-4"
                >
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5" />
                    Admin Dashboard
                  </div>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              )}
              
              <button
                onClick={() => setActiveTab("account")}
                className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                  activeTab === "account"
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-gray-100"
                }`}
              >
                <User className="w-5 h-5" />
                Account
              </button>
              
              {!isSuperadmin && (
                <>
                  <button
                    onClick={() => setActiveTab("brand")}
                    className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                      activeTab === "brand"
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    <Palette className="w-5 h-5" />
                    Brand & Voice
                  </button>
                  
                  <button
                    onClick={() => setActiveTab("voice-training")}
                    className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                      activeTab === "voice-training"
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    <Shield className="w-5 h-5" />
                    Voice Training & Guardrails
                  </button>
                  
                  <button
                    onClick={() => setActiveTab("billing")}
                    className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                      activeTab === "billing"
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    <CreditCard className="w-5 h-5" />
                    Billing & Subscription
                  </button>
                </>
              )}
              
              <Link
                href="/settings/connections"
                className="w-full text-left px-4 py-3 rounded-medium flex items-center justify-between hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Link2 className="w-5 h-5" />
                  Social Connections
                </div>
                <ChevronRight className="w-4 h-4 text-text-secondary" />
              </Link>
              
              <Link
                href="/settings/posting-schedule"
                className="w-full text-left px-4 py-3 rounded-medium flex items-center justify-between hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5" />
                  Posting Schedule
                </div>
                <ChevronRight className="w-4 h-4 text-text-secondary" />
              </Link>

              <Link
                href="/settings/logo"
                className="w-full text-left px-4 py-3 rounded-medium flex items-center justify-between hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Image className="w-5 h-5" />
                  Logo & Watermark
                </div>
                <ChevronRight className="w-4 h-4 text-text-secondary" />
              </Link>
              
              <button
                onClick={() => setActiveTab("notifications")}
                className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                  activeTab === "notifications"
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-gray-100"
                }`}
              >
                <Bell className="w-5 h-5" />
                Notifications
              </button>
              
              <button
                onClick={() => setActiveTab("security")}
                className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                  activeTab === "security"
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-gray-100"
                }`}
              >
                <Shield className="w-5 h-5" />
                Security
              </button>
            </nav>
          </div>

          {/* Content Area */}
          <div className="md:col-span-3">
            {activeTab === "account" && (
              <div className="card">
                <h2 className="text-xl font-heading font-bold mb-6">Account Settings</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="label">Your Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="input-field"
                    />
                  </div>
                  
                  <div>
                    <label className="label">Email</label>
                    <input
                      type="email"
                      value={userData?.email || ""}
                      disabled
                      className="input-field opacity-50 cursor-not-allowed"
                    />
                    <p className="text-xs text-text-secondary mt-1">
                      Email cannot be changed
                    </p>
                  </div>
                  
                  <div>
                    <label className="label">Pub Name</label>
                    <input
                      type="text"
                      value={pubName}
                      onChange={(e) => setPubName(e.target.value)}
                      className="input-field"
                    />
                  </div>
                  
                  <div className="pt-4">
                    <button
                      onClick={handleSaveAccount}
                      disabled={saving}
                      className="btn-primary"
                    >
                      {saving ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          Save Changes
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "brand" && (
              <div className="card">
                <h2 className="text-xl font-heading font-bold mb-6">Brand & Voice</h2>
                
                <div className="space-y-6">
                  <div>
                    <label className="label">Business Type</label>
                    <select
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      className="input-field"
                    >
                      <option value="">Select type</option>
                      <option value="pub">Traditional Pub</option>
                      <option value="bar">Modern Bar</option>
                      <option value="restaurant">Restaurant</option>
                      <option value="hotel">Hotel Bar</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="label">Brand Voice (Choose up to 3)</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {TONE_ATTRIBUTES.map((tone) => (
                        <button
                          key={tone}
                          onClick={() => handleToneToggle(tone)}
                          disabled={!toneAttributes.includes(tone) && toneAttributes.length >= 3}
                          className={`px-3 py-2 rounded-soft border-2 text-sm transition-all ${
                            toneAttributes.includes(tone)
                              ? "border-primary bg-primary text-white"
                              : "border-border hover:border-primary/50 disabled:opacity-50"
                          }`}
                        >
                          {tone}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <label className="label">Target Audience</label>
                    <textarea
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                      className="input-field min-h-[100px]"
                      placeholder="E.g., Local families, young professionals, sports fans..."
                    />
                  </div>
                  
                  <div className="pt-4">
                    <button
                      onClick={handleSaveBrand}
                      disabled={saving}
                      className="btn-primary"
                    >
                      {saving ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          Save Brand Settings
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "voice-training" && (
              <div className="space-y-6">
                {/* Sub-tabs for Voice Training */}
                <div className="flex gap-4 border-b border-border">
                  <button
                    onClick={() => setVoiceSubTab('identity')}
                    className={`pb-3 px-1 font-medium transition-colors ${
                      voiceSubTab === 'identity'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-text-secondary hover:text-primary'
                    }`}
                  >
                    Brand Identity
                  </button>
                  <button
                    onClick={() => setVoiceSubTab('guardrails')}
                    className={`pb-3 px-1 font-medium transition-colors flex items-center gap-2 ${
                      voiceSubTab === 'guardrails'
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

                {/* Identity Tab Content */}
                {voiceSubTab === 'identity' ? (
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
                          onClick={handleSaveBrand}
                          disabled={saving || !brandIdentity.trim()}
                          className="btn-primary flex items-center gap-2"
                        >
                          {saving ? (
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
                    {/* Guardrails Tab Content */}
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
              </div>
            )}

            {activeTab === "billing" && (
              <div className="space-y-6">
                <div className="card">
                  <h2 className="text-xl font-heading font-bold mb-6">Billing & Subscription</h2>
                  
                  {/* Current Plan */}
                  <div className="mb-8">
                    <h3 className="font-semibold mb-4">Current Plan</h3>
                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-medium">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-lg font-semibold">
                          {userData?.tenant?.subscription_tier || "free"} Plan
                        </span>
                        {userData?.tenant?.subscription_status === "active" && (
                          <span className="badge-success">Active</span>
                        )}
                        {userData?.tenant?.subscription_status === "trialing" && (
                          <span className="badge-warning">Trial</span>
                        )}
                      </div>
                      {userData?.tenant?.trial_ends_at && (
                        <p className="text-sm text-text-secondary">
                          Trial ends: {new Date(userData.tenant.trial_ends_at).toLocaleDateString('en-GB')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Usage Stats */}
                  <div className="mb-8">
                    <h3 className="font-semibold mb-4">Usage This Month</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-4 bg-gray-50 rounded-medium">
                        <p className="text-2xl font-bold">{usage.campaigns}</p>
                        <p className="text-sm text-text-secondary">Campaigns</p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-medium">
                        <p className="text-2xl font-bold">{usage.posts}</p>
                        <p className="text-sm text-text-secondary">Posts</p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-medium">
                        <p className="text-2xl font-bold">{usage.mediaAssets}</p>
                        <p className="text-sm text-text-secondary">Media Assets</p>
                      </div>
                    </div>
                  </div>

                  {/* Billing Period Toggle */}
                  <div className="mb-8">
                    <div className="flex items-center justify-center gap-4 mb-6">
                      <span className={billingPeriod === "monthly" ? "font-semibold" : "text-text-secondary"}>
                        Monthly
                      </span>
                      <button
                        onClick={() => setBillingPeriod(billingPeriod === "monthly" ? "annual" : "monthly")}
                        className="relative w-12 h-6 bg-gray-300 rounded-full transition-colors data-[checked]:bg-primary"
                        data-checked={billingPeriod === "annual" || undefined}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                            billingPeriod === "annual" ? "translate-x-6" : ""
                          }`}
                        />
                      </button>
                      <span className={billingPeriod === "annual" ? "font-semibold" : "text-text-secondary"}>
                        Annual <span className="text-success text-sm">(Save 20%)</span>
                      </span>
                    </div>
                  </div>

                  {/* Pricing Tiers */}
                  <div className="grid md:grid-cols-2 gap-6">
                    {Object.entries(PRICING_TIERS).map(([tierName, tier]) => {
                      const isCurrentPlan = userData?.tenant?.subscription_tier?.toLowerCase() === tierName.toLowerCase();
                      const monthlyPrice = tier.monthlyPrice;
                      const annualPrice = tier.annualPrice;
                      const displayPrice = billingPeriod === "monthly" ? monthlyPrice : annualPrice;
                      
                      return (
                        <div
                          key={tierName}
                          className={`p-6 rounded-medium border-2 ${
                            isCurrentPlan ? "border-primary bg-primary/5" : "border-border"
                          }`}
                        >
                          <div className="mb-4">
                            <h3 className="text-xl font-bold capitalize">{tierName}</h3>
                            <p className="text-3xl font-bold mt-2">
                              £{displayPrice}
                              <span className="text-lg font-normal text-text-secondary">
                                /{billingPeriod === "monthly" ? "mo" : "yr"}
                              </span>
                            </p>
                            {billingPeriod === "annual" && (
                              <p className="text-sm text-success mt-1">
                                £{Math.round((monthlyPrice * 12 - annualPrice) / 12)}/mo saved
                              </p>
                            )}
                          </div>

                          <ul className="space-y-3 mb-6">
                            {tier.features.campaigns && (
                              <li className="flex items-start gap-2">
                                <Check className="w-5 h-5 text-success mt-0.5" />
                                <span className="text-sm">
                                  {tier.features.campaigns === -1 ? "Unlimited" : tier.features.campaigns} campaigns/month
                                </span>
                              </li>
                            )}
                            {tier.features.posts && (
                              <li className="flex items-start gap-2">
                                <Check className="w-5 h-5 text-success mt-0.5" />
                                <span className="text-sm">
                                  {tier.features.posts === -1 ? "Unlimited" : tier.features.posts} posts/month
                                </span>
                              </li>
                            )}
                            {tier.features.aiGeneration && (
                              <li className="flex items-start gap-2">
                                <Check className="w-5 h-5 text-success mt-0.5" />
                                <span className="text-sm">
                                  {tier.features.aiGeneration === -1 ? "Unlimited" : tier.features.aiGeneration} AI generations
                                </span>
                              </li>
                            )}
                            {tier.features.teamMembers && tier.features.teamMembers > 1 && (
                              <li className="flex items-start gap-2">
                                <Users className="w-5 h-5 text-success mt-0.5" />
                                <span className="text-sm">
                                  Up to {tier.features.teamMembers} team members
                                </span>
                              </li>
                            )}
                            {tier.features.prioritySupport && (
                              <li className="flex items-start gap-2">
                                <Phone className="w-5 h-5 text-success mt-0.5" />
                                <span className="text-sm">Priority support</span>
                              </li>
                            )}
                          </ul>

                          {isCurrentPlan ? (
                            <button
                              onClick={handleCancelSubscription}
                              className="btn-ghost text-error w-full"
                              disabled={userData?.tenant?.subscription_status !== "active"}
                            >
                              Cancel Subscription
                            </button>
                          ) : (
                            <button
                              onClick={() => handleUpgrade(tierName)}
                              disabled={processingTier === tierName}
                              className="btn-primary w-full"
                            >
                              {processingTier === tierName ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                  Processing...
                                </>
                              ) : (
                                <>Upgrade to {tierName}</>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "notifications" && (
              <div className="card">
                <h2 className="text-xl font-heading font-bold mb-6">Notification Preferences</h2>
                <p className="text-text-secondary mb-4">
                  Manage how and when you receive notifications from CheersAI.
                </p>
                <Link href="/settings/notifications" className="btn-primary">
                  Manage Notifications
                </Link>
              </div>
            )}

            {activeTab === "security" && (
              <div className="card">
                <h2 className="text-xl font-heading font-bold mb-6">Security Settings</h2>
                <div className="space-y-4">
                  <div className="p-4 bg-primary/5 rounded-medium">
                    <p className="text-sm font-medium mb-1">Two-Factor Authentication</p>
                    <p className="text-sm text-text-secondary">
                      Coming soon - Add an extra layer of security to your account
                    </p>
                  </div>
                  
                  <div className="p-4 bg-gray-50 rounded-medium">
                    <p className="text-sm font-medium mb-1">Password</p>
                    <p className="text-sm text-text-secondary mb-3">
                      Keep your account secure with a strong password
                    </p>
                    <Link href="/settings/change-password" className="btn-secondary text-sm inline-block">
                      Change Password
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}