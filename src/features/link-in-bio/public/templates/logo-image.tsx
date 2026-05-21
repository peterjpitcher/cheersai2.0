import Image from "next/image";

interface LinkInBioLogoProps {
  logoMedia: { url: string } | null | undefined;
  name: string;
  className?: string;
}

export function LinkInBioLogo({ logoMedia, name, className = "" }: LinkInBioLogoProps) {
  if (!logoMedia?.url) return null;

  return (
    <Image
      src={logoMedia.url}
      alt={`${name} logo`}
      width={320}
      height={160}
      className={`h-auto max-h-28 w-auto max-w-44 object-contain ${className}`.trim()}
      unoptimized
      sizes="176px"
      priority
    />
  );
}
