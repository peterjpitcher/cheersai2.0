"use client";

import { useEffect } from "react";

interface BrandColorProviderProps {
  brandColor?: string;
  children: React.ReactNode;
}

export function BrandColorProvider({ brandColor, children }: BrandColorProviderProps) {
  useEffect(() => {
    if (brandColor) {
      // Convert hex to HSL for better manipulation
      const hsl = hexToHSL(brandColor);
      
      // Apply the brand color as CSS variables
      const root = document.documentElement;
      
      // Set primary color to brand color
      root.style.setProperty('--primary', hsl);
      
      // Generate lighter and darker variants
      const [h, s, l] = hsl.split(' ').map(v => parseFloat(v));
      
      // Lighter variant for hover states
      const lighterL = Math.min(l + 10, 95);
      root.style.setProperty('--primary-light', `${h} ${s}% ${lighterL}%`);
      
      // Darker variant for active states
      const darkerL = Math.max(l - 10, 20);
      root.style.setProperty('--primary-dark', `${h} ${s}% ${darkerL}%`);
      
      // Ensure good contrast for text on primary color
      const foregroundL = l > 50 ? 4 : 98; // Dark text on light bg, light text on dark bg
      root.style.setProperty('--primary-foreground', `${h} 9% ${foregroundL}%`);
    }
  }, [brandColor]);

  return <>{children}</>;
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