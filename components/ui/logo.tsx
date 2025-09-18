import Image from "next/image";

interface LogoProps {
  className?: string;
  showTagline?: boolean;
  variant?: "full" | "icon" | "compact";
  isDark?: boolean; // For dark backgrounds, use reversed logo
}

export default function Logo({ className = "", showTagline = false, variant = "full", isDark = false }: LogoProps) {
  // Select appropriate logo based on variant and background
  const getLogoSrc = () => {
    if (variant === "icon") {
      return "/logo_icon_only.png";
    }
    
    // Use lozenge logo only for compact variant (header navigation)
    if (variant === "compact") {
      return isDark ? "/logo_lozenge_white.png" : "/logo_lozenge_black.png";
    }
    
    // Use full logo for auth pages and other full-size displays
    return isDark ? "/logo_reversed.png" : "/logo.png";
  };

  // Get dimensions for Next.js Image component
  const getDimensions = () => {
    switch (variant) {
      case "compact":
        // Compact variant for headers - height matches h-11 (44px) or h-16 (64px)
        return { width: 200, height: 44 };
      
      case "icon":
        // Icon variant should be small and square-ish
        return { width: 60, height: 60 };
      
      case "full":
      default:
        // Full variant for auth pages, homepage, etc.
        return { width: 300, height: 140 };
    }
  };

  const dimensions = getDimensions();

  return (
    <div className={`relative inline-block ${className}`}>
      <Image
        src={getLogoSrc()}
        alt="CheersAI Logo"
        width={dimensions.width}
        height={dimensions.height}
        className="size-auto"
        style={{
          width: 'auto',
          height: 'auto',
          maxHeight: variant === "full" ? '140px' : variant === "icon" ? '60px' : variant === "compact" ? '44px' : 'none',
          objectFit: 'contain'
        }}
        priority={variant === "full" || variant === "compact"}
        quality={90}
      />
      {showTagline && (
        <p className="mt-1 text-center text-xs text-gray-500">
          Smart Social for Hospitality
        </p>
      )}
    </div>
  );
}
