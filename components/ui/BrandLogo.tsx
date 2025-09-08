"use client";

import BrandedLogo from "@/components/ui/branded-logo";

type Variant = "header" | "auth" | "icon";

interface BrandLogoProps {
  className?: string;
  variant?: Variant;
  isDark?: boolean;
}

// Lightweight alias that maps app-friendly variants onto our existing
// branded/logo component, ensuring consistent next/image usage and CLS.
export default function BrandLogo({ className = "", variant = "auth" }: BrandLogoProps) {
  const map = (v: Variant): "compact" | "full" | "icon" => {
    if (v === "header") return "compact";
    if (v === "icon") return "icon";
    return "full";
  };

  // BrandedLogo wraps next/image with fixed dimensions and priority where relevant
  return <BrandedLogo className={className} variant={map(variant)} />;
}

