"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Bell, Mail, MessageSquare, Calendar, TrendingUp, 
  AlertCircle, ChevronLeft, Loader2, Save
} from "lucide-react";
import Link from "next/link";

interface NotificationSettings {
  email_enabled: boolean;
  email_frequency: 'instant' | 'daily' | 'weekly';
  post_published: boolean;
  post_failed: boolean;
  post_scheduled: boolean;
  campaign_complete: boolean;
  trial_reminders: boolean;
  marketing_emails: boolean;
  product_updates: boolean;
}

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>({
    email_enabled: true,
    email_frequency: 'instant',
    post_published: true,
    post_failed: true,
    post_scheduled: false,
    campaign_complete: true,
    trial_reminders: true,
    marketing_emails: false,
    product_updates: true,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // In a real app, fetch from database
    // For now, using default settings
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Save to database
    // In production, you'd save these preferences
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call

    setSaving(false);
    alert("Notification settings saved!");
  };

  const handleToggle = (key: keyof NotificationSettings) => {
    setSettings(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
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
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-text-secondary hover:text-primary">
              <ChevronLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold">Notification Settings</h1>
              <p className="text-sm text-text-secondary">
                Choose how you want to be notified
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Email Notifications Master Toggle */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-primary" />
              <div>
                <h3 className="font-semibold">Email Notifications</h3>
                <p className="text-sm text-text-secondary">
                  Receive updates via email
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.email_enabled}
                onChange={() => handleToggle('email_enabled')}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {settings.email_enabled && (
            <div className="pl-8 space-y-2">
              <label className="text-sm">
                <span className="text-text-secondary">Frequency:</span>
                <select
                  value={settings.email_frequency}
                  onChange={(e) => setSettings(prev => ({ ...prev, email_frequency: e.target.value as any }))}
                  className="ml-2 px-3 py-1 border border-border rounded-soft text-sm"
                >
                  <option value="instant">Instant</option>
                  <option value="daily">Daily Digest</option>
                  <option value="weekly">Weekly Summary</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {/* Publishing Notifications */}
        <div className="card mb-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            Publishing Updates
          </h3>
          <div className="space-y-4">
            <NotificationToggle
              label="Post Published"
              description="When your post is successfully published"
              checked={settings.post_published}
              onChange={() => handleToggle('post_published')}
              disabled={!settings.email_enabled}
            />
            <NotificationToggle
              label="Post Failed"
              description="When a post fails to publish"
              checked={settings.post_failed}
              onChange={() => handleToggle('post_failed')}
              disabled={!settings.email_enabled}
            />
            <NotificationToggle
              label="Scheduled Reminders"
              description="1 hour before scheduled posts"
              checked={settings.post_scheduled}
              onChange={() => handleToggle('post_scheduled')}
              disabled={!settings.email_enabled}
            />
            <NotificationToggle
              label="Campaign Complete"
              description="When all posts in a campaign are published"
              checked={settings.campaign_complete}
              onChange={() => handleToggle('campaign_complete')}
              disabled={!settings.email_enabled}
            />
          </div>
        </div>

        {/* Account Notifications */}
        <div className="card mb-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Account & Billing
          </h3>
          <div className="space-y-4">
            <NotificationToggle
              label="Trial Reminders"
              description="Reminders about trial expiration"
              checked={settings.trial_reminders}
              onChange={() => handleToggle('trial_reminders')}
              disabled={!settings.email_enabled}
            />
          </div>
        </div>

        {/* Marketing & Updates */}
        <div className="card mb-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Marketing & Updates
          </h3>
          <div className="space-y-4">
            <NotificationToggle
              label="Marketing Emails"
              description="Tips, best practices, and special offers"
              checked={settings.marketing_emails}
              onChange={() => handleToggle('marketing_emails')}
              disabled={!settings.email_enabled}
            />
            <NotificationToggle
              label="Product Updates"
              description="New features and improvements"
              checked={settings.product_updates}
              onChange={() => handleToggle('product_updates')}
              disabled={!settings.email_enabled}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
          </button>
        </div>

        {/* Info Box */}
        <div className="mt-8 bg-primary/5 border border-primary/20 rounded-medium p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-primary mb-1">Important Notifications</p>
              <p className="text-text-secondary">
                Some notifications like security alerts and critical system updates cannot be disabled 
                for your account&apos;s safety.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NotificationToggle({
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-text-secondary">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-disabled:opacity-50"></div>
      </label>
    </div>
  );
}