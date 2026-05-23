/**
 * Grid template: 2-column tile grid, square hero, compact layout.
 * Server component for LCP performance (PERF-03).
 * No 'Powered by CheersAI' footer (D-11).
 */

import { MediaFrameImage, resolveMediaPlacement } from '@/components/media/media-frame';
import type { PublicLinkInBioPageData, PublicLinkInBioTile } from '@/lib/link-in-bio/types';
import { LinkInBioLogo } from './logo-image';

interface GridTemplateProps {
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

export function GridTemplate({
  profile,
  logoMedia,
  heroMedia,
  ctaButtons,
  tilesSection,
  campaignsSection,
  socialLinks,
}: GridTemplateProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 text-center text-[#fff7e8]">
      {/* Hero image */}
      {heroMedia ? (
        <MediaFrameImage
          src={heroMedia.url}
          alt="Venue highlight"
          placement={resolveMediaPlacement({ placement: heroMedia.shape })}
          size="calendar"
          className="rounded-[var(--r-lg)] border-[#d7b56d]/25 bg-black/15"
          unoptimized
          priority
        />
      ) : null}

      {/* Venue info */}
      <div className="flex max-w-2xl flex-col items-center gap-2">
        <LinkInBioLogo logoMedia={logoMedia} name={profile.displayName ?? profile.slug} />
        {!logoMedia?.url ? (
          <h1 className="text-xl font-bold">
            {profile.displayName ?? profile.slug}
          </h1>
        ) : null}
        {profile.bio ? (
          <p className="max-w-md text-sm text-[#f7ead0]/75">{profile.bio}</p>
        ) : null}
      </div>

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
