"use client";

import { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface BrandingConfig {
  name: string;
  logoUrl?: string;
  primaryColor: string;
  isWhitelabel: boolean;
}

const defaultBranding: BrandingConfig = {
  name: "CheersAI",
  logoUrl: "/logo.svg",
  primaryColor: "#EA580C",
  isWhitelabel: false,
};

const BrandingContext = createContext<BrandingConfig>(defaultBranding);

export function useBranding() {
  return useContext(BrandingContext);
}

export function WhitelabelProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBranding() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      // Get user's tenant info and brand profile
      const { data: userData } = await supabase
        .from("users")
        .select(`
          tenant_id,
          tenant:tenants (
            id,
            name,
            subscription_tier,
            whitelabel_config
          )
        `)
        .eq("id", user.id)
        .single();

      // Get brand profile for the tenant (contains user's chosen color)
      let brandColor = defaultBranding.primaryColor;
      if (userData?.tenant_id) {
        const { data: brandProfile } = await supabase
          .from("brand_profiles")
          .select("primary_color")
          .eq("tenant_id", userData.tenant_id)
          .single();
        
        if (brandProfile?.primary_color) {
          brandColor = brandProfile.primary_color;
        }
      }

      if (userData?.tenant?.subscription_tier === "enterprise" && userData?.tenant?.whitelabel_config) {
        // Apply whitelabel branding for enterprise users
        const config = userData.tenant.whitelabel_config as any;
        setBranding({
          name: config.brand_name || userData.tenant.name,
          logoUrl: config.logo_url || defaultBranding.logoUrl,
          primaryColor: config.primary_color || brandColor, // Use whitelabel color or brand profile color
          isWhitelabel: true,
        });
      } else {
        // Use brand profile color for non-enterprise users
        setBranding({
          ...defaultBranding,
          primaryColor: brandColor,
        });
      }
      
      setLoading(false);
    }

    loadBranding();
  }, []);

  // Apply brand color to CSS variables
  useEffect(() => {
    if (branding.primaryColor && branding.primaryColor !== defaultBranding.primaryColor) {
      const root = document.documentElement;
      
      // Convert hex to HSL for CSS variables
      const hsl = hexToHSL(branding.primaryColor);
      root.style.setProperty('--primary', hsl);
      
      // Generate variants
      const [h, s, l] = hsl.split(' ').map(v => parseFloat(v));
      
      // Ensure good contrast for text on primary color
      const foregroundL = l > 50 ? 4 : 98;
      root.style.setProperty('--primary-foreground', `${h} 9% ${foregroundL}%`);
    }
  }, [branding.primaryColor]);

  if (loading) {
    return <>{children}</>;
  }

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

function hexToHSL(hex: string): string {
  // Remove the hash if present
  hex = hex.replace('#', '');
  
  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  
  // Convert to CSS HSL format
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}