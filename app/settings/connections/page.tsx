"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Facebook, Instagram, MapPin, Plus, Trash2, 
  Check, X, Loader2, Link2, ChevronLeft, AlertCircle
} from "lucide-react";
import Link from "next/link";

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string;
  is_active: boolean;
  created_at: string;
}

const PLATFORMS = [
  {
    id: "facebook",
    name: "Facebook",
    icon: Facebook,
    color: "bg-blue-600",
    description: "Connect your Facebook Page to publish posts directly",
    available: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: Instagram,
    color: "bg-gradient-to-br from-purple-600 to-pink-500",
    description: "Share to Instagram Business accounts",
    available: true,
  },
  {
    id: "google_my_business",
    name: "Google My Business",
    icon: MapPin,
    color: "bg-green-600",
    description: "Post updates to your Google Business Profile",
    available: true,
    comingSoon: false,
  },
];

export default function ConnectionsPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
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

    // Get social connections (legacy table)
    const { data: legacyConnections } = await supabase
      .from("social_connections")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false });

    // Get social accounts (new table that includes GMB)
    const { data: socialAccounts } = await supabase
      .from("social_accounts")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false });

    // Merge both sources and format consistently
    const allConnections = [];
    
    if (legacyConnections) {
      allConnections.push(...legacyConnections);
    }
    
    if (socialAccounts) {
      // Convert social_accounts format to match social_connections format
      const formattedAccounts = socialAccounts.map(account => ({
        id: account.id,
        platform: account.platform,
        account_name: account.account_name || account.location_name || 'Connected Account',
        page_name: account.location_name,
        is_active: account.is_active,
        created_at: account.created_at,
      }));
      allConnections.push(...formattedAccounts);
    }

    const data = allConnections;

    if (data) {
      setConnections(data);
    }
    setLoading(false);
  };

  const handleConnect = async (platform: string) => {
    setConnecting(platform);
    
    try {
      // Start OAuth flow
      const response = await fetch("/api/social/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });

      const { authUrl, error } = await response.json();
      
      if (error) {
        alert(error);
        setConnecting(null);
        return;
      }

      // Redirect to OAuth provider
      window.location.href = authUrl;
    } catch (error) {
      console.error("Connection error:", error);
      alert("Failed to start connection process");
      setConnecting(null);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm("Are you sure you want to disconnect this account?")) return;

    const supabase = createClient();
    
    // Try deleting from both tables
    const { error: legacyError } = await supabase
      .from("social_connections")
      .delete()
      .eq("id", connectionId);

    const { error: accountError } = await supabase
      .from("social_accounts")
      .delete()
      .eq("id", connectionId);

    if (legacyError && accountError) {
      alert("Failed to disconnect account");
      return;
    }

    fetchConnections();
  };

  const toggleConnection = async (connectionId: string, isActive: boolean) => {
    const supabase = createClient();
    
    // Try updating both tables
    const { error: legacyError } = await supabase
      .from("social_connections")
      .update({ is_active: !isActive })
      .eq("id", connectionId);

    const { error: accountError } = await supabase
      .from("social_accounts")
      .update({ is_active: !isActive })
      .eq("id", connectionId);

    if (!legacyError || !accountError) {
      fetchConnections();
    }
  };

  const getConnectionForPlatform = (platformId: string) => {
    return connections.find(c => c.platform === platformId);
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
                <h1 className="text-2xl font-heading font-bold">Social Connections</h1>
                <p className="text-sm text-text-secondary">
                  Connect your social media accounts for direct publishing
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Info Banner */}
        <div className="bg-primary/10 border border-primary/20 rounded-medium p-4 mb-8">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-text-primary mb-1">
                Direct Publishing Available
              </p>
              <p className="text-sm text-text-secondary">
                Connect your social media accounts to publish posts directly from CheersAI. 
                Your posts will be automatically formatted for each platform.
              </p>
            </div>
          </div>
        </div>

        {/* Platform Cards */}
        <div className="space-y-4">
          {PLATFORMS.map((platform) => {
            const connection = getConnectionForPlatform(platform.id);
            const Icon = platform.icon;

            return (
              <div
                key={platform.id}
                className={`card ${
                  platform.comingSoon ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`${platform.color} p-3 rounded-medium text-white`}>
                    <Icon className="w-6 h-6" />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                          {platform.name}
                          {platform.comingSoon && (
                            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full">
                              Coming Soon
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-text-secondary mt-1">
                          {platform.description}
                        </p>

                        {connection && (
                          <div className="mt-3 space-y-1">
                            <p className="text-sm">
                              <span className="text-text-secondary">Account:</span>{" "}
                              <span className="font-medium">{connection.account_name}</span>
                            </p>
                            {connection.page_name && (
                              <p className="text-sm">
                                <span className="text-text-secondary">Page:</span>{" "}
                                <span className="font-medium">{connection.page_name}</span>
                              </p>
                            )}
                            <p className="text-sm">
                              <span className="text-text-secondary">Connected:</span>{" "}
                              {new Date(connection.created_at).toLocaleDateString("en-GB")}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {connection ? (
                          <>
                            <button
                              onClick={() => toggleConnection(connection.id, connection.is_active)}
                              className={`px-3 py-1 rounded-soft text-sm font-medium transition-colors ${
                                connection.is_active
                                  ? "bg-success/10 text-success"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {connection.is_active ? "Active" : "Paused"}
                            </button>
                            <button
                              onClick={() => handleDisconnect(connection.id)}
                              className="text-error hover:bg-error/10 p-2 rounded-soft transition-colors"
                              title="Disconnect"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleConnect(platform.id)}
                            disabled={connecting === platform.id || platform.comingSoon}
                            className="btn-secondary flex items-center"
                          >
                            {connecting === platform.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Link2 className="w-4 h-4 mr-2" />
                                Connect
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Help Section */}
        <div className="mt-8 card bg-gray-50">
          <h3 className="font-semibold mb-2">How it works</h3>
          <ol className="space-y-2 text-sm text-text-secondary">
            <li>1. Connect your social media business accounts</li>
            <li>2. Create and generate your campaign content</li>
            <li>3. Choose which platforms to publish to</li>
            <li>4. Posts are automatically formatted and published at the scheduled time</li>
          </ol>
        </div>
      </main>
    </div>
  );
}