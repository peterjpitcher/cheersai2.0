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

  // Different sizing strategies for different variants
  const getImageStyle = () => {
    switch (variant) {
      case "compact":
        // For compact variant in headers, use 100% height of container
        // This respects the h-11 or h-16 classes on the parent
        return { height: '100%', width: 'auto', objectFit: 'contain' as const };
      
      case "icon":
        // Icon variant should be small
        return { maxHeight: '60px', width: 'auto', objectFit: 'contain' as const };
      
      case "full":
      default:
        // Full variant for auth pages, homepage, etc. - should be prominent
        // 140px gives good visibility without being overwhelming
        return { maxHeight: '140px', width: 'auto', objectFit: 'contain' as const };
    }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <img
        src={getLogoSrc()}
        alt="CheersAI Logo"
        style={getImageStyle()}
      />
      {showTagline && (
        <p className="text-xs text-gray-500 mt-1 text-center">
          Smart Social for Hospitality
        </p>
      )}
    </div>
  );
}