"use client";

import { useState } from "react";
import { Instagram, Loader2 } from "lucide-react";

export default function InstagramConnectButton() {
  const [loading, setLoading] = useState(false);

  const handleConnect = () => {
    setLoading(true);
    
    // Instagram Business Login uses Facebook's OAuth flow
    const clientId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID || "1138649858083556";
    const redirectUri = encodeURIComponent("https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business");
    const state = Math.random().toString(36).substring(7); // Random state for security
    
    // Instagram Business API permissions
    const scope = encodeURIComponent([
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_comments",
      "instagram_manage_insights",
      "instagram_manage_messages",
      "pages_show_list",
      "pages_read_engagement",
      "business_management",
    ].join(","));
    
    // Redirect to Instagram Business Login (via Facebook)
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
      `client_id=${clientId}` +
      `&redirect_uri=${redirectUri}` +
      `&state=${state}` +
      `&scope=${scope}` +
      `&response_type=code` +
      `&auth_type=rerequest`; // Force re-authentication if needed
    
    window.location.href = authUrl;
  };

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      className="btn-primary w-full flex items-center justify-center gap-2"
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          Connecting...
        </>
      ) : (
        <>
          <Instagram className="w-5 h-5" />
          Connect Instagram Business
        </>
      )}
    </button>
  );
}