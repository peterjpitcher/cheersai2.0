/**
 * Minimal template: single column, no hero, list-style tiles, minimal branding.
 * Server component for LCP performance (PERF-03).
 * No 'Powered by CheersAI' footer (D-11).
 */

import type { PublicLinkInBioPageData, PublicLinkInBioTile } from '@/lib/link-in-bio/types';
import { LinkInBioLogo } from './logo-image';

interface MinimalTemplateProps {
  profile: PublicLinkInBioPageData['profile'];
  tiles: PublicLinkInBioTile[];
  campaigns: PublicLinkInBioPageData['campaigns'];
  logoMedia: PublicLinkInBioPageData['logoMedia'];
  heroMedia: PublicLinkInBioPageData['heroMedia'];
  slug: string;
  ctaButtons: React.ReactNode;
  tilesSection: React.ReactNode;
  campaignsSection: React.ReactNode;
  socialLinks: React.ReactNode;
}

export function MinimalTemplate({
  profile,
  logoMedia,
  ctaButtons,
  tilesSection,
  campaignsSection,
  socialLinks,
}: MinimalTemplateProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 text-center text-[#fff7e8]">
      {/* No hero image in minimal template */}

      <LinkInBioLogo logoMedia={logoMedia} name={profile.displayName ?? profile.slug} className="max-h-20 max-w-36" />

      {/* Venue name only - no bio in minimal */}
      {!logoMedia?.url ? (
        <h1 className="text-xl font-semibold">
          {profile.displayName ?? profile.slug}
        </h1>
      ) : null}

      {/* CTA buttons */}
      {ctaButtons}

      {/* Campaigns */}
      {campaignsSection}

      {/* Always-on quick links */}
      {tilesSection}

      {/* Social links */}
      {socialLinks}
    </div>
  );
}
