"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PRICING_TIERS } from "@/lib/stripe/config";
import { loadStripe } from "@stripe/stripe-js";
import {
  User, Building, Palette, CreditCard, LogOut,
  ChevronRight, Save, Loader2, ChevronLeft, Bell, Shield, Link2, Clock, Image,
  Plus, Trash2, Eye, EyeOff, CheckCircle, Check, X, Zap, TrendingUp, Users, Phone,
  Download, AlertTriangle, FileText
} from "lucide-react";
import Link from "next/link";
import { generateWatermarkStyles, getDefaultWatermarkSettings, validateWatermarkSettings, PREVIEW_CONTAINER_SIZE } from "@/lib/utils/watermark";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

const TONE_ATTRIBUTES = [
  "Friendly", "Professional", "Witty", "Traditional",
  "Modern", "Casual", "Upbeat", "Sophisticated"
];

interface UserData {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  tenant: {
    id: string;
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

interface Logo {
  id: string;
  logo_type: string;
  file_url: string;
  file_name: string;
  is_active: boolean;
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
  
  // Logo & Watermark states
  const [logos, setLogos] = useState<any[]>([]);
  const [watermarkSettings, setWatermarkSettings] = useState({
    enabled: false,
    position: 'bottom-right',
    opacity: 0.8,
    size_percent: 15,
    margin_pixels: 20,
    auto_apply: false,
    active_logo_id: '',
  });
  const [uploading, setUploading] = useState(false);
  
  // Form states
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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

  // GDPR Data Retention states
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [retentionPolicies, setRetentionPolicies] = useState<any[]>([]);

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
        first_name,
        last_name,
        full_name,
        is_superadmin,
        tenant:tenants!inner (
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
      const tenant = Array.isArray(data.tenant) ? data.tenant[0] : data.tenant;
      setUserData({
        ...data,
        email: user.email || "",
        tenant: tenant,
      });
      setFirstName(data.first_name || "");
      setLastName(data.last_name || "");
      setFullName(data.full_name || "");
      setPubName(tenant?.name || "");

      // Get brand profile
      const { data: brand } = await supabase
        .from("brand_profiles")
        .select("*")
        .eq("tenant_id", tenant?.id)
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
      const tenantId = Array.isArray(data.tenant) ? data.tenant[0]?.id : data.tenant.id;
      
      // Count campaigns
      const { count: campaignCount } = await supabase
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId);

      // Count posts
      const { count: postCount } = await supabase
        .from("campaign_posts")
        .select("*, campaign!inner(tenant_id)", { count: "exact", head: true })
        .eq("campaign.tenant_id", tenantId);

      // Count media assets
      const { count: mediaCount } = await supabase
        .from("media_assets")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId);

      setUsage({
        campaigns: campaignCount || 0,
        posts: postCount || 0,
        mediaAssets: mediaCount || 0,
      });
      
      // Fetch logos for logo tab
      const { data: logosData } = await supabase
        .from("tenant_logos")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (logosData) {
        setLogos(logosData);
      }

      // Fetch watermark settings
      const { data: settingsData } = await supabase
        .from("watermark_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .single();

      if (settingsData) {
        setWatermarkSettings({
          enabled: settingsData.enabled,
          position: settingsData.position,
          opacity: settingsData.opacity,
          size_percent: settingsData.size_percent,
          margin_pixels: settingsData.margin_pixels,
          auto_apply: settingsData.auto_apply,
          active_logo_id: settingsData.active_logo_id || '',
        });
      }
    }

    // Fetch data retention policies
    try {
      const { data: policiesData } = await supabase
        .from('data_retention_policies')
        .select('*')
        .order('data_type');
      
      if (policiesData) {
        setRetentionPolicies(policiesData);
      }
    } catch (error) {
      console.error('Error fetching retention policies:', error);
    }

    // Check for existing deletion request
    if (data) {
      const { data: deletionData } = await supabase
        .from('user_deletion_requests')
        .select('status')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .single();
      
      if (deletionData) {
        setDeletionRequested(true);
      }
    }

    setLoading(false);
  };

  const handleSaveAccount = async () => {
    setSaving(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Update user name fields
    const updatedFullName = `${firstName} ${lastName}`.trim();
    await supabase
      .from("users")
      .update({ 
        first_name: firstName,
        last_name: lastName,
        full_name: updatedFullName
      })
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

  const handleExportData = async () => {
    setExportingData(true);
    try {
      const response = await fetch('/api/gdpr/export-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ export_type: 'gdpr_request' })
      });

      const result = await response.json();
      
      if (result.success) {
        // Create and download file
        const dataStr = JSON.stringify(result.data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `cheersai-data-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        
        alert('Your data has been exported and downloaded. This file contains all your personal data as required by UK data protection law.');
      } else {
        alert('Failed to export data: ' + result.error);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export data. Please try again later.');
    }
    setExportingData(false);
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete your account? This action cannot be undone.\n\n' +
      'Your data will be permanently deleted after 30 days as required by UK data protection law.\n' +
      'You can cancel this request within 30 days by contacting support.'
    );
    
    if (!confirmed) return;

    const reason = window.prompt('Please tell us why you\'re leaving (optional):');
    
    setDeletingAccount(true);
    try {
      const response = await fetch('/api/gdpr/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });

      const result = await response.json();
      
      if (result.success) {
        setDeletionRequested(true);
        alert(
          'Account deletion has been initiated.\n\n' +
          'Your data will be permanently deleted in 30 days as required by UK ICO guidelines.\n' +
          'You can contact support within 30 days to cancel this request.'
        );
      } else {
        alert('Failed to delete account: ' + result.error);
      }
    } catch (error) {
      console.error('Deletion error:', error);
      alert('Failed to delete account. Please try again later.');
    }
    setDeletingAccount(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    setUploading(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Upload to storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${userData.tenant_id}/logo-${Date.now()}.${fileExt}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("media")
      .upload(fileName, file);

    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage
        .from("media")
        .getPublicUrl(fileName);

      // Save logo reference
      const { data: logo, error } = await supabase
        .from("tenant_logos")
        .insert({
          tenant_id: userData.tenant_id,
          logo_type: 'default',
          file_url: publicUrl,
          file_name: file.name,
        })
        .select()
        .single();

      if (!error && logo) {
        setLogos([logo, ...logos]);
      }
    }

    setUploading(false);
  };

  const handleDeleteLogo = async (logoId: string) => {
    if (!confirm("Delete this logo?")) return;

    const supabase = createClient();
    
    const { error } = await supabase
      .from("tenant_logos")
      .delete()
      .eq("id", logoId);

    if (!error) {
      setLogos(logos.filter(l => l.id !== logoId));
    }
  };

  const handleSaveWatermarkSettings = async () => {
    setSaving(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("watermark_settings")
      .upsert({
        tenant_id: userData.tenant_id,
        ...watermarkSettings,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id'
      });

    if (!error) {
      setSaving(false);
      alert("Watermark settings saved successfully!");
    } else {
      setSaving(false);
      alert("Failed to save watermark settings");
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
              {/* Back Button with better styling */}
              <Link 
                href="/dashboard" 
                className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors p-2 -ml-2 rounded-medium hover:bg-gray-100"
                title="Back to Dashboard"
              >
                <ChevronLeft className="w-5 h-5" />
                <span className="hidden sm:inline text-sm font-medium">Dashboard</span>
              </Link>
              
              {/* Breadcrumb and Title */}
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-text-secondary">/</span>
                <h1 className="text-2xl font-heading font-bold">Settings</h1>
              </div>
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
                    onClick={() => setActiveTab("logo")}
                    className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                      activeTab === "logo"
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    <Image className="w-5 h-5" />
                    Brand & Logo
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

              <button
                onClick={() => setActiveTab("data-retention")}
                className={`w-full text-left px-4 py-3 rounded-medium flex items-center gap-3 transition-colors ${
                  activeTab === "data-retention"
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-gray-100"
                }`}
              >
                <FileText className="w-5 h-5" />
                Data & Privacy
                {deletionRequested && (
                  <span className="badge-warning text-xs ml-auto">Deletion Pending</span>
                )}
              </button>
            </nav>
          </div>

          {/* Content Area */}
          <div className="md:col-span-3">
            {activeTab === "account" && (
              <div className="card">
                <h2 className="text-xl font-heading font-bold mb-6">Account Settings</h2>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">First Name</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="input-field"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="label">Last Name</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="input-field"
                        placeholder="Smith"
                      />
                    </div>
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

            {activeTab === "logo" && (
              <div className="space-y-6">
                {/* Logo Upload Section */}
                <div className="card">
                  <h2 className="text-xl font-heading font-bold mb-6">Brand & Logo</h2>
                  <h3 className="font-semibold mb-4">Your Logos</h3>
                  
                  {/* Upload Button */}
                  <div className="mb-4">
                    <input
                      type="file"
                      id="logo-upload"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                    <label
                      htmlFor="logo-upload"
                      className="btn-primary inline-flex items-center cursor-pointer"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Upload Logo
                        </>
                      )}
                    </label>
                    <p className="text-sm text-text-secondary mt-2">
                      PNG or SVG with transparent background recommended
                    </p>
                  </div>

                  {/* Logo Grid */}
                  {logos.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-medium">
                      <Image className="w-12 h-12 text-text-secondary/30 mx-auto mb-3" />
                      <p className="text-text-secondary">No logos uploaded yet</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                      {logos.map((logo) => (
                        <div
                          key={logo.id}
                          className="relative group border border-border rounded-medium p-4 hover:shadow-md transition-shadow"
                        >
                          <div className="aspect-square bg-gray-100 rounded-soft mb-2 p-2">
                            <img
                              src={logo.file_url}
                              alt={logo.file_name}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <p className="text-xs text-center truncate">{logo.file_name}</p>
                          <button
                            onClick={() => handleDeleteLogo(logo.id)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full p-1 shadow-md"
                          >
                            <Trash2 className="w-4 h-4 text-error" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Watermark Preview */}
                {logos.length > 0 && (
                  <div className="card">
                    <h3 className="font-semibold mb-4">Watermark Preview</h3>
                    <div className="bg-gray-100 rounded-medium p-4">
                      <div className="relative mx-auto aspect-square" style={{ maxWidth: '400px' }}>
                        <img 
                          src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=800&fit=crop&q=80"
                          alt="Preview"
                          className="w-full h-full object-cover rounded-soft"
                        />
                        {watermarkSettings.enabled && logos.length > 0 && (() => {
                          const activeLogo = watermarkSettings.active_logo_id 
                            ? logos.find(l => l.id === watermarkSettings.active_logo_id) 
                            : logos[0];
                          
                          if (!activeLogo) return null;
                          
                          return (
                            <div className="absolute">
                              <img
                                src={activeLogo.file_url}
                                alt="Watermark"
                                className="object-contain"
                                style={generateWatermarkStyles(watermarkSettings, PREVIEW_CONTAINER_SIZE)}
                              />
                            </div>
                          );
                        })()}
                      </div>
                      <p className="text-xs text-text-secondary mt-3 text-center">
                        This preview shows how your watermark will appear on uploaded images
                      </p>
                    </div>
                  </div>
                )}

                {/* Watermark Settings */}
                <div className="card">
                  <h3 className="font-semibold mb-4">Watermark Settings</h3>
                  
                  <div className="space-y-6">
                    {/* Enable/Disable */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Enable Watermarks</p>
                        <p className="text-sm text-text-secondary">Add logo to uploaded images</p>
                      </div>
                      <button
                        onClick={() => setWatermarkSettings({ ...watermarkSettings, enabled: !watermarkSettings.enabled })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          watermarkSettings.enabled ? 'bg-primary' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            watermarkSettings.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Active Logo Selection */}
                    {logos.length > 1 && (
                      <div>
                        <label className="block text-sm font-medium mb-2">Active Logo for Watermark</label>
                        <select
                          value={watermarkSettings.active_logo_id || logos[0]?.id || ''}
                          onChange={(e) => setWatermarkSettings({ ...watermarkSettings, active_logo_id: e.target.value })}
                          className="input-field"
                          disabled={!watermarkSettings.enabled}
                        >
                          {logos.map((logo) => (
                            <option key={logo.id} value={logo.id}>
                              {logo.file_name} ({logo.logo_type})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Position */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Position</label>
                      <select
                        value={watermarkSettings.position}
                        onChange={(e) => setWatermarkSettings({ ...watermarkSettings, position: e.target.value })}
                        className="input-field"
                        disabled={!watermarkSettings.enabled}
                      >
                        <option value="top-left">Top Left</option>
                        <option value="top-right">Top Right</option>
                        <option value="bottom-left">Bottom Left</option>
                        <option value="bottom-right">Bottom Right</option>
                      </select>
                    </div>

                    {/* Size */}
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Logo Size: {watermarkSettings.size_percent}%
                      </label>
                      <input
                        type="range"
                        min="5"
                        max="50"
                        value={watermarkSettings.size_percent}
                        onChange={(e) => setWatermarkSettings({ ...watermarkSettings, size_percent: parseInt(e.target.value) })}
                        className="w-full"
                        disabled={!watermarkSettings.enabled}
                      />
                    </div>

                    {/* Opacity */}
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Opacity: {Math.round(watermarkSettings.opacity * 100)}%
                      </label>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.1"
                        value={watermarkSettings.opacity}
                        onChange={(e) => setWatermarkSettings({ ...watermarkSettings, opacity: parseFloat(e.target.value) })}
                        className="w-full"
                        disabled={!watermarkSettings.enabled}
                      />
                    </div>

                    {/* Margin */}
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Margin: {watermarkSettings.margin_pixels}px
                      </label>
                      <input
                        type="range"
                        min="5"
                        max="50"
                        value={watermarkSettings.margin_pixels}
                        onChange={(e) => setWatermarkSettings({ ...watermarkSettings, margin_pixels: parseInt(e.target.value) })}
                        className="w-full"
                        disabled={!watermarkSettings.enabled}
                      />
                    </div>

                    {/* Save Button */}
                    <div className="pt-4 border-t border-border">
                      <button
                        onClick={handleSaveWatermarkSettings}
                        disabled={saving}
                        className="btn-primary flex items-center"
                      >
                        {saving ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4 mr-2" />
                            Save Watermark Settings
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
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

            {activeTab === "data-retention" && (
              <div className="space-y-6">
                {/* UK GDPR Compliance Notice */}
                <div className="card">
                  <div className="flex items-start gap-3 mb-4">
                    <Shield className="w-6 h-6 text-primary mt-1" />
                    <div>
                      <h2 className="text-xl font-heading font-bold mb-2">Data & Privacy Rights</h2>
                      <p className="text-sm text-text-secondary">
                        Your data protection rights under UK GDPR and Data Protection Act 2018
                      </p>
                    </div>
                  </div>

                  {deletionRequested && (
                    <div className="p-4 bg-warning/10 border border-warning/20 rounded-medium mb-6">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
                        <div>
                          <p className="font-medium text-warning">Account Deletion Pending</p>
                          <p className="text-sm text-text-secondary mt-1">
                            Your account deletion request is being processed. Your data will be permanently deleted 
                            in accordance with UK ICO guidelines (30-day retention period).
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Data Export Section */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Download className="w-5 h-5 text-primary" />
                    Export Your Data
                  </h3>
                  <p className="text-sm text-text-secondary mb-4">
                    Download all personal data we hold about you. This includes your account details, campaigns, 
                    posts, and analytics data (compliant with UK data portability rights).
                  </p>
                  <button
                    onClick={handleExportData}
                    disabled={exportingData}
                    className="btn-primary flex items-center gap-2"
                  >
                    {exportingData ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Exporting Data...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Export My Data
                      </>
                    )}
                  </button>
                </div>

                {/* Data Retention Policies */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4">Data Retention Policies</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    How long we keep different types of data (compliant with UK ICO guidelines):
                  </p>
                  
                  <div className="space-y-3">
                    {retentionPolicies.map((policy) => (
                      <div key={policy.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-medium">
                        <div>
                          <p className="font-medium text-sm">
                            {policy.data_type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                          </p>
                          <p className="text-xs text-text-secondary">{policy.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-sm">
                            {policy.retention_days === 0 ? 'While active' : `${policy.retention_days} days`}
                          </p>
                          {policy.uk_ico_compliant && (
                            <p className="text-xs text-success">✓ UK ICO Compliant</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Account Deletion Section */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-error" />
                    Delete Account
                  </h3>
                  
                  <div className="p-4 bg-error/5 border border-error/20 rounded-medium mb-4">
                    <p className="text-sm font-medium mb-2">⚠️ This action cannot be undone</p>
                    <ul className="text-sm text-text-secondary space-y-1">
                      <li>• All your campaigns, posts, and media will be deleted</li>
                      <li>• Your social media connections will be removed</li>
                      <li>• Data will be permanently deleted after 30 days (UK ICO requirement)</li>
                      <li>• You can cancel the deletion request within 30 days by contacting support</li>
                    </ul>
                  </div>
                  
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount || deletionRequested}
                    className="btn-error flex items-center gap-2"
                  >
                    {deletingAccount ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing Deletion...
                      </>
                    ) : deletionRequested ? (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        Deletion Pending
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete My Account
                      </>
                    )}
                  </button>
                </div>

                {/* UK Data Protection Notice */}
                <div className="card">
                  <h3 className="text-lg font-semibold mb-4">Your UK Data Protection Rights</h3>
                  <div className="text-sm text-text-secondary space-y-2">
                    <p>Under UK GDPR and the Data Protection Act 2018, you have the right to:</p>
                    <ul className="list-disc list-inside space-y-1 ml-4">
                      <li>Access your personal data (fulfilled by the Export Data feature above)</li>
                      <li>Rectify inaccurate personal data (update through Account settings)</li>
                      <li>Erase your personal data (Delete Account feature above)</li>
                      <li>Restrict processing of your personal data</li>
                      <li>Data portability (Export Data feature above)</li>
                      <li>Object to processing of your personal data</li>
                    </ul>
                    <p className="mt-3">
                      For any data protection queries or to exercise your rights, please contact our Data Protection Officer 
                      at <a href="mailto:privacy@cheersai.com" className="text-primary hover:underline">privacy@cheersai.com</a>.
                    </p>
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