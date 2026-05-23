/**
 * Magazine template: 2-column with large hero banner, card tiles with images, editorial feel.
 * Server component for LCP performance (PERF-03).
 * No 'Powered by CheersAI' footer (D-11).
 */

import { MediaFrameImage, resolveMediaPlacement } from '@/components/media/media-frame';
import type { PublicLinkInBioPageData, PublicLinkInBioTile } from '@/lib/link-in-bio/types';
import { LinkInBioLogo } from './logo-image';

interface MagazineTemplateProps {
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

export function MagazineTemplate({
  profile,
  logoMedia,
  heroMedia,
  ctaButtons,
  tilesSection,
  campaignsSection,
  socialLinks,
}: MagazineTemplateProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 text-center text-[#fff7e8]">
      {/* Large hero banner */}
      {heroMedia ? (
        <MediaFrameImage
          src={heroMedia.url}
          alt="Venue highlight"
          placement={resolveMediaPlacement({ placement: heroMedia.shape })}
          size="full"
          className="rounded-[var(--r-lg)] border-[#d7b56d]/25 bg-black/15"
          unoptimized
          sizes="(min-width: 1024px) 768px, 100vw"
          priority
        />
      ) : null}

      {/* Venue info */}
      <div className="flex max-w-2xl flex-col items-center gap-3">
        <LinkInBioLogo logoMedia={logoMedia} name={profile.displayName ?? profile.slug} className="max-h-32 max-w-52" />
        {!logoMedia?.url ? (
          <h1 className="text-3xl font-bold tracking-normal">
            {profile.displayName ?? profile.slug}
          </h1>
        ) : null}
        {profile.bio ? (
          <p className="max-w-lg text-base leading-relaxed text-[#f7ead0]/75">{profile.bio}</p>
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
