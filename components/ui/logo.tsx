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
    // Use reversed logo for dark backgrounds
    return isDark ? "/logo_reversed.png" : "/logo.png";
  };

  // Set dimensions based on variant
  const getDimensions = () => {
    switch (variant) {
      case "icon":
        return { width: 40, height: 40 };
      case "compact":
        return { width: 120, height: 40 };
      default:
        return { width: 200, height: 50 };
    }
  };

  const { width, height } = getDimensions();

  return (
    <div className={`relative inline-block ${className}`}>
      <Image
        src={getLogoSrc()}
        alt="CheersAI Logo"
        width={width}
        height={height}
        className="object-contain"
        priority
      />
      {showTagline && (
        <p className="text-xs text-gray-500 mt-1 text-center">
          Smart Social for Hospitality
        </p>
      )}
    </div>
  );
}