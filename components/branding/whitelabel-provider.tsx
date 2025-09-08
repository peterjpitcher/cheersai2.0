"use client";

import { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface BrandingConfig {
  name: string;
  logoUrl?: string;
  primaryColor?: string; // optional to avoid hard-coded fallback
  isWhitelabel: boolean;
}

const defaultBranding: BrandingConfig = {
  name: "CheersAI",
  logoUrl: "/logo.svg",
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
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select(`
          tenant_id,
          tenant:tenants (
            id,
            name,
            subscription_tier
          )
        `)
        .eq("id", user.id)
        .single();

      if (userError) {
        console.error("Error fetching user data:", userError);
        setLoading(false);
        return;
      }

      // Get brand profile for the tenant (contains user's chosen color)
      let brandColor: string | undefined = undefined;
      if (userData?.tenant_id) {
        const { data: brandProfile, error: brandError } = await supabase
          .from("brand_profiles")
          .select("primary_color")
          .eq("tenant_id", userData.tenant_id)
          .single();
        
        if (brandError) {
          console.error("Error fetching brand profile:", brandError);
        } else if (brandProfile?.primary_color) {
          brandColor = brandProfile.primary_color;
        }
      }

      // For now, enterprise users get standard branding with brand profile color
      // TODO: Add whitelabel_config column to tenants table if enterprise whitelabel features are needed
      setBranding({ ...defaultBranding, primaryColor: brandColor });
      
      setLoading(false);
    }

    loadBranding();
  }, []);

  // Apply brand color to CSS variables
  useEffect(() => {
    if (branding.primaryColor) {
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
