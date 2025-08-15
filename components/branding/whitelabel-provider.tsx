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

      // Get user's tenant info
      const { data: userData } = await supabase
        .from("users")
        .select(`
          tenant:tenants (
            name,
            subscription_tier,
            whitelabel_config
          )
        `)
        .eq("id", user.id)
        .single();

      if (userData?.tenant?.subscription_tier === "enterprise" && userData?.tenant?.whitelabel_config) {
        // Apply whitelabel branding for enterprise users
        const config = userData.tenant.whitelabel_config as any;
        setBranding({
          name: config.brand_name || userData.tenant.name,
          logoUrl: config.logo_url || defaultBranding.logoUrl,
          primaryColor: config.primary_color || defaultBranding.primaryColor,
          isWhitelabel: true,
        });
      } else {
        // Use default CheersAI branding
        setBranding(defaultBranding);
      }
      
      setLoading(false);
    }

    loadBranding();
  }, []);

  if (loading) {
    return <>{children}</>;
  }

  return (
    <BrandingContext.Provider value={branding}>
      <style jsx global>{`
        :root {
          --brand-primary: ${branding.primaryColor};
        }
      `}</style>
      {children}
    </BrandingContext.Provider>
  );
}