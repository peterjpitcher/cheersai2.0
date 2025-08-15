"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Settings, Save, Loader2, ChevronLeft, 
  AlertTriangle, Globe, Hash, Type, MessageSquare
} from "lucide-react";
import Link from "next/link";

interface ContentSetting {
  id?: string;
  setting_key: string;
  setting_value: string;
  description: string;
}

const SETTINGS_CONFIG = [
  {
    key: "global_tone_instructions",
    label: "Global Tone Instructions",
    description: "Default instructions for content tone and style across all tenants",
    icon: Type,
    placeholder: "Be friendly, welcoming, and professional. Use British English spelling and idioms.",
    multiline: true,
  },
  {
    key: "hashtag_preferences",
    label: "Hashtag Preferences",
    description: "Default hashtag strategy and preferences",
    icon: Hash,
    placeholder: "Include 5-10 relevant hashtags. Mix popular and niche tags. Always include location-based hashtags.",
    multiline: true,
  },
  {
    key: "content_restrictions",
    label: "Content Restrictions",
    description: "Words, phrases, or topics to avoid in generated content",
    icon: AlertTriangle,
    placeholder: "Avoid mentioning competitors, political topics, or controversial subjects.",
    multiline: true,
  },
  {
    key: "platform_specific_rules",
    label: "Platform-Specific Rules",
    description: "Special instructions for each social media platform",
    icon: Globe,
    placeholder: "Facebook: Focus on community engagement. Instagram: Emphasize visuals. Twitter: Keep it concise.",
    multiline: true,
  },
  {
    key: "call_to_action_templates",
    label: "Call-to-Action Templates",
    description: "Default CTAs to include in posts",
    icon: MessageSquare,
    placeholder: "Book your table today! | Join us tonight! | Don't miss out!",
    multiline: true,
  },
];

export default function ContentSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdminAndFetchSettings();
  }, []);

  const checkAdminAndFetchSettings = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Check if user is superadmin
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (userData?.role !== "superadmin") {
      alert("Access denied. Superadmin privileges required.");
      router.push("/dashboard");
      return;
    }

    setIsAdmin(true);

    // Fetch existing settings
    const { data: settingsData } = await supabase
      .from("global_content_settings")
      .select("*");

    if (settingsData) {
      const settingsMap: Record<string, string> = {};
      settingsData.forEach(setting => {
        settingsMap[setting.setting_key] = setting.setting_value || "";
      });
      setSettings(settingsMap);
    }

    setLoading(false);
  };

  const updateSetting = (key: string, value: string) => {
    setSettings({ ...settings, [key]: value });
  };

  const saveSettings = async () => {
    setSaving(true);
    const supabase = createClient();

    try {
      // Upsert all settings
      for (const config of SETTINGS_CONFIG) {
        const value = settings[config.key] || "";
        
        const { error } = await supabase
          .from("global_content_settings")
          .upsert({
            setting_key: config.key,
            setting_value: value,
            description: config.description,
          }, {
            onConflict: "setting_key"
          });

        if (error) throw error;
      }

      alert("Global content settings saved successfully!");
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Failed to save settings");
    }

    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-text-secondary hover:text-primary">
              <ChevronLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold">Global Content Settings</h1>
              <p className="text-sm text-text-secondary">
                Configure AI content generation for all tenants
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Admin Notice */}
        <div className="card bg-warning/10 border-warning/30 mb-6">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Superadmin Area</p>
              <p className="text-sm text-text-secondary">
                These settings affect content generation for all tenants in the system. 
                Changes here will influence how AI generates content across the entire platform.
              </p>
            </div>
          </div>
        </div>

        {/* Settings Form */}
        <div className="space-y-6">
          {SETTINGS_CONFIG.map(config => {
            const Icon = config.icon;
            
            return (
              <div key={config.key} className="card">
                <div className="flex items-start gap-3 mb-3">
                  <div className="bg-primary/10 p-2 rounded-medium">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{config.label}</h3>
                    <p className="text-sm text-text-secondary">{config.description}</p>
                  </div>
                </div>
                
                {config.multiline ? (
                  <textarea
                    value={settings[config.key] || ""}
                    onChange={(e) => updateSetting(config.key, e.target.value)}
                    placeholder={config.placeholder}
                    rows={4}
                    className="input-field w-full resize-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={settings[config.key] || ""}
                    onChange={(e) => updateSetting(config.key, e.target.value)}
                    placeholder={config.placeholder}
                    className="input-field w-full"
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Example Usage */}
        <div className="card mt-6">
          <h3 className="font-semibold mb-3">How These Settings Are Used</h3>
          <div className="space-y-2 text-sm text-text-secondary">
            <p>• These instructions are included in every AI content generation request</p>
            <p>• Individual tenants can override these with their own brand preferences</p>
            <p>• Platform-specific rules are applied automatically based on the target platform</p>
            <p>• Content restrictions help maintain brand safety across all generated content</p>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-8 flex justify-end gap-3">
          <Link href="/dashboard" className="btn-secondary">
            Cancel
          </Link>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Settings
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}