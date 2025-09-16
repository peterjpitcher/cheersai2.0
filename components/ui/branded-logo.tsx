"use client";

import { useBranding } from "@/components/branding/whitelabel-provider";
import Logo from "@/components/ui/logo";
import Image from "next/image";

interface BrandedLogoProps {
  className?: string;
  variant?: "full" | "compact" | "icon";
}

export default function BrandedLogo({ className, variant = "full" }: BrandedLogoProps) {
  const branding = useBranding();

  if (branding.isWhitelabel && branding.logoUrl && branding.logoUrl !== "/logo.svg") {
    // Use custom whitelabel logo
    return (
      <Image
        src={branding.logoUrl}
        alt={branding.name}
        width={variant === "icon" ? 40 : 150}
        height={40}
        className={className}
        style={{ width: 'auto', height: 'auto' }}
        priority
      />
    );
  }

  // Use default CheersAI logo
  return <Logo className={className} variant={variant} />;
}
