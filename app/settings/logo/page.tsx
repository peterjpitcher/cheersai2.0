"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronLeft, Upload, Trash2, Loader2, Save,
  Image, Eye, EyeOff, Settings, Check
} from "lucide-react";
import Link from "next/link";

interface Logo {
  id: string;
  logo_type: string;
  file_url: string;
  file_name: string;
  is_active: boolean;
  created_at: string;
}

interface WatermarkSettings {
  enabled: boolean;
  position: string;
  opacity: number;
  size_percent: number;
  margin_pixels: number;
  auto_apply: boolean;
  active_logo_id?: string;
}

export default function LogoSettingsPage() {
  const router = useRouter();
  const [logos, setLogos] = useState<Logo[]>([]);
  const [settings, setSettings] = useState<WatermarkSettings>({
    enabled: false,
    position: 'bottom-right',
    opacity: 0.8,
    size_percent: 15,
    margin_pixels: 20,
    auto_apply: false,
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Fetch logos
    const { data: logosData } = await supabase
      .from("tenant_logos")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false });

    if (logosData) {
      setLogos(logosData);
    }

    // Fetch watermark settings
    const { data: settingsData } = await supabase
      .from("watermark_settings")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (settingsData) {
      setSettings({
        enabled: settingsData.enabled,
        position: settingsData.position,
        opacity: settingsData.opacity,
        size_percent: settingsData.size_percent,
        margin_pixels: settingsData.margin_pixels,
        auto_apply: settingsData.auto_apply,
      });
    }

    setLoading(false);
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

  const handleSaveSettings = async () => {
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
        ...settings,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id'
      });

    if (!error) {
      // Show success feedback
      setSaving(false);
      alert("Settings saved successfully!");
    } else {
      setSaving(false);
      alert("Failed to save settings");
    }
  };

  const POSITIONS = [
    { value: 'top-left', label: 'Top Left' },
    { value: 'top-right', label: 'Top Right' },
    { value: 'bottom-left', label: 'Bottom Left' },
    { value: 'bottom-right', label: 'Bottom Right' },
  ];

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
                <h1 className="text-2xl font-heading font-bold">Logo & Watermark</h1>
                <p className="text-sm text-text-secondary">
                  Manage your logos and watermark settings
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Logo Upload Section */}
        <div className="card mb-6">
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
                  <Upload className="w-4 h-4 mr-2" />
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
          <div className="card mb-6">
            <h3 className="font-semibold mb-4">Watermark Preview</h3>
            <div className="bg-gray-100 rounded-medium p-4">
              <div className="relative mx-auto" style={{ maxWidth: '600px' }}>
                {/* Demo image - using Unsplash for free stock photo */}
                <img 
                  src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80"
                  alt="Preview"
                  className="w-full rounded-soft"
                />
                {settings.enabled && (() => {
                  const activeLogo = settings.active_logo_id 
                    ? logos.find(l => l.id === settings.active_logo_id) 
                    : logos[0];
                  return activeLogo ? (
                    <div 
                      className="absolute p-4"
                      style={{
                        top: settings.position.includes('top') ? `${settings.margin_pixels}px` : 'auto',
                        bottom: settings.position.includes('bottom') ? `${settings.margin_pixels}px` : 'auto',
                        left: settings.position.includes('left') ? `${settings.margin_pixels}px` : 'auto',
                        right: settings.position.includes('right') ? `${settings.margin_pixels}px` : 'auto',
                      }}
                    >
                      <img
                        src={activeLogo.file_url}
                        alt="Watermark"
                        className="object-contain"
                        style={{
                          width: `${settings.size_percent * 3}px`,
                          height: 'auto',
                          opacity: settings.opacity,
                          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                        }}
                      />
                    </div>
                  ) : null;
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
                onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.enabled ? 'bg-primary' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Active Logo Selection */}
            {logos.length > 1 && (
              <div>
                <label className="block text-sm font-medium mb-2">Active Logo for Watermark</label>
                <select
                  value={settings.active_logo_id || logos[0]?.id || ''}
                  onChange={(e) => setSettings({ ...settings, active_logo_id: e.target.value })}
                  className="input-field"
                  disabled={!settings.enabled}
                >
                  {logos.map((logo) => (
                    <option key={logo.id} value={logo.id}>
                      {logo.file_name} ({logo.logo_type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Auto Apply */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Auto Apply</p>
                <p className="text-sm text-text-secondary">Automatically add watermark to all uploads</p>
              </div>
              <button
                onClick={() => setSettings({ ...settings, auto_apply: !settings.auto_apply })}
                disabled={!settings.enabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.auto_apply && settings.enabled ? 'bg-primary' : 'bg-gray-300'
                } ${!settings.enabled ? 'opacity-50' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.auto_apply ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Position */}
            <div>
              <label className="block text-sm font-medium mb-2">Position</label>
              <select
                value={settings.position}
                onChange={(e) => setSettings({ ...settings, position: e.target.value })}
                className="input-field"
                disabled={!settings.enabled}
              >
                {POSITIONS.map((pos) => (
                  <option key={pos.value} value={pos.value}>
                    {pos.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Size */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Logo Size: {settings.size_percent}%
              </label>
              <input
                type="range"
                min="5"
                max="30"
                value={settings.size_percent}
                onChange={(e) => setSettings({ ...settings, size_percent: parseInt(e.target.value) })}
                className="w-full"
                disabled={!settings.enabled}
              />
            </div>

            {/* Opacity */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Opacity: {Math.round(settings.opacity * 100)}%
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={settings.opacity}
                onChange={(e) => setSettings({ ...settings, opacity: parseFloat(e.target.value) })}
                className="w-full"
                disabled={!settings.enabled}
              />
            </div>

            {/* Margin */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Margin: {settings.margin_pixels}px
              </label>
              <input
                type="range"
                min="5"
                max="50"
                value={settings.margin_pixels}
                onChange={(e) => setSettings({ ...settings, margin_pixels: parseInt(e.target.value) })}
                className="w-full"
                disabled={!settings.enabled}
              />
            </div>

            {/* Save Button */}
            <div className="pt-4 border-t border-border">
              <button
                onClick={handleSaveSettings}
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
                    Save Settings
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}