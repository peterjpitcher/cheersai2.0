"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  User, Building, Palette, CreditCard, LogOut,
  ChevronRight, Save, Loader2, ChevronLeft, Bell, Shield, Link2, Clock, Image
} from "lucide-react";
import Link from "next/link";

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
}

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("account");
  const [userData, setUserData] = useState<UserData | null>(null);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Form states
  const [fullName, setFullName] = useState("");
  const [pubName, setPubName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [toneAttributes, setToneAttributes] = useState<string[]>([]);
  const [targetAudience, setTargetAudience] = useState("");

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
        tenant:tenants (
          id,
          name,
          subscription_status,
          subscription_tier
        )
      `)
      .eq("id", user.id)
      .single();

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
      }
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
        });
    }

    setSaving(false);
    alert("Brand settings saved!");
  };

  const handleToneToggle = (tone: string) => {
    if (toneAttributes.includes(tone)) {
      setToneAttributes(toneAttributes.filter(t => t !== tone));
    } else if (toneAttributes.length < 3) {
      setToneAttributes([...toneAttributes, tone]);
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
              
              <Link
                href="/settings/brand-voice"
                className="w-full text-left px-4 py-3 rounded-medium flex items-center justify-between hover:bg-gray-100 transition-colors pl-12"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm">Voice Training & Guardrails</span>
                </div>
                <ChevronRight className="w-4 h-4 text-text-secondary" />
              </Link>
              
              <Link
                href="/billing"
                className="w-full text-left px-4 py-3 rounded-medium flex items-center justify-between hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5" />
                  Billing
                </div>
                <ChevronRight className="w-4 h-4 text-text-secondary" />
              </Link>
              
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
                  
                  <div className="pt-4 flex gap-3">
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
                    <Link
                      href="/settings/brand-voice"
                      className="btn-secondary"
                    >
                      Advanced Voice Training →
                    </Link>
                  </div>
                </div>
                
                {/* Info Box */}
                <div className="mt-6 p-4 bg-primary/5 border border-primary/20 rounded-medium">
                  <p className="text-sm font-medium mb-2">🎯 Advanced Brand Voice Features</p>
                  <p className="text-sm text-text-secondary mb-3">
                    Train AI to write exactly like you with advanced voice training, brand identity, and content guardrails.
                  </p>
                  <Link
                    href="/settings/brand-voice"
                    className="text-sm text-primary font-medium hover:underline"
                  >
                    Go to Voice Training & Guardrails →
                  </Link>
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