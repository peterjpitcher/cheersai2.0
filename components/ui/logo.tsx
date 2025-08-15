interface LogoProps {
  className?: string;
  showTagline?: boolean;
  variant?: "full" | "icon" | "compact";
}

export default function Logo({ className = "", showTagline = false, variant = "full" }: LogoProps) {
  if (variant === "icon") {
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" className={className} xmlns="http://www.w3.org/2000/svg">
        <g id="beer-icon">
          <rect x="5" y="10" width="20" height="25" rx="2" fill="#F59E0B" stroke="#D97706" strokeWidth="1.5"/>
          <ellipse cx="15" cy="10" rx="10" ry="4" fill="#FEF3C7"/>
          <circle cx="11" cy="7" r="2.5" fill="#FEF3C7"/>
          <circle cx="19" cy="7" r="2" fill="#FEF3C7"/>
          <circle cx="15" cy="5" r="2.5" fill="#FEF3C7"/>
          <path d="M 25 15 Q 30 15, 30 20 Q 30 25, 25 25" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="10" cy="20" r="1" fill="#FED7AA" opacity="0.7"/>
          <circle cx="17" cy="25" r="1.2" fill="#FED7AA" opacity="0.6"/>
          <circle cx="13" cy="28" r="0.8" fill="#FED7AA" opacity="0.8"/>
        </g>
      </svg>
    );
  }

  if (variant === "compact") {
    return (
      <svg width="120" height="40" viewBox="0 0 120 40" className={className} xmlns="http://www.w3.org/2000/svg">
        <g id="beer-icon">
          <rect x="5" y="10" width="15" height="20" rx="1.5" fill="#F59E0B" stroke="#D97706" strokeWidth="1"/>
          <ellipse cx="12.5" cy="10" rx="7.5" ry="3" fill="#FEF3C7"/>
          <circle cx="10" cy="8" r="1.5" fill="#FEF3C7"/>
          <circle cx="15" cy="8" r="1.5" fill="#FEF3C7"/>
          <path d="M 20 14 Q 24 14, 24 18 Q 24 22, 20 22" fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round"/>
        </g>
        <text x="30" y="24" fontFamily="Arial, sans-serif" fontSize="18" fontWeight="bold" fill="#1F2937">
          Cheers<tspan fill="#EA580C">AI</tspan>
        </text>
      </svg>
    );
  }

  // Full logo (default)
  return (
    <svg width="200" height="50" viewBox="0 0 200 50" className={className} xmlns="http://www.w3.org/2000/svg">
      <g id="beer-icon">
        <rect x="10" y="15" width="20" height="25" rx="2" fill="#F59E0B" stroke="#D97706" strokeWidth="1.5"/>
        <ellipse cx="20" cy="15" rx="10" ry="4" fill="#FEF3C7"/>
        <circle cx="16" cy="12" r="2.5" fill="#FEF3C7"/>
        <circle cx="24" cy="12" r="2" fill="#FEF3C7"/>
        <circle cx="20" cy="10" r="2.5" fill="#FEF3C7"/>
        <path d="M 30 20 Q 35 20, 35 25 Q 35 30, 30 30" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="15" cy="25" r="1" fill="#FED7AA" opacity="0.7"/>
        <circle cx="22" cy="30" r="1.2" fill="#FED7AA" opacity="0.6"/>
        <circle cx="18" cy="33" r="0.8" fill="#FED7AA" opacity="0.8"/>
      </g>
      
      <text x="45" y="30" fontFamily="Arial, sans-serif" fontSize="24" fontWeight="bold" fill="#1F2937">
        Cheers
      </text>
      
      <text x="125" y="30" fontFamily="Arial, sans-serif" fontSize="24" fontWeight="bold">
        <tspan fill="#EA580C">AI</tspan>
      </text>
      
      <g id="sparkle" transform="translate(155, 20)">
        <path d="M 0 -3 L 1 0 L 0 3 L -1 0 Z" fill="#F59E0B"/>
        <path d="M -3 0 L 0 -1 L 3 0 L 0 1 Z" fill="#F59E0B"/>
      </g>
      
      {showTagline && (
        <text x="45" y="42" fontFamily="Arial, sans-serif" fontSize="8" fill="#6B7280">
          Smart Social for Hospitality
        </text>
      )}
    </svg>
  );
}