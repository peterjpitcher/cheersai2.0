/**
 * Grid template: 2-column tile grid, square hero, compact layout.
 * Server component for LCP performance (PERF-03).
 * No 'Powered by CheersAI' footer (D-11).
 */

import Image from 'next/image';

import type { PublicLinkInBioPageData, PublicLinkInBioTile } from '@/lib/link-in-bio/types';
import { ClickTracker } from '../click-tracker';
import { LinkInBioLogo } from './logo-image';

interface GridTemplateProps {
  profile: PublicLinkInBioPageData['profile'];
  tiles: PublicLinkInBioTile[];
  campaigns: PublicLinkInBioPageData['campaigns'];
  logoMedia: PublicLinkInBioPageData['logoMedia'];
  heroMedia: PublicLinkInBioPageData['heroMedia'];
  slug: string;
  ctaButtons: React.ReactNode;
  campaignsSection: React.ReactNode;
  socialLinks: React.ReactNode;
}

export function GridTemplate({
  profile,
  tiles,
  logoMedia,
  heroMedia,
  slug,
  ctaButtons,
  campaignsSection,
  socialLinks,
}: GridTemplateProps) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-8 text-center text-white">
      {/* Square hero */}
      {heroMedia ? (
        <div className="mx-auto w-32 h-32 overflow-hidden rounded-2xl border border-white/20 bg-white/5">
          <Image
            src={heroMedia.url}
            alt="Venue highlight"
            width={256}
            height={256}
            className="h-full w-full object-cover"
            unoptimized
            priority
          />
        </div>
      ) : null}

      {/* Venue info */}
      <div className="flex flex-col items-center gap-2">
        <LinkInBioLogo logoMedia={logoMedia} name={profile.displayName ?? profile.slug} />
        <h1 className="text-xl font-bold">
          {profile.displayName ?? profile.slug}
        </h1>
        {profile.bio ? (
          <p className="text-sm text-white/80 max-w-md">{profile.bio}</p>
        ) : null}
      </div>

      {/* CTA buttons */}
      {ctaButtons}

      {/* Campaigns */}
      {campaignsSection}

      {/* Tiles - 2-column grid */}
      {tiles.length > 0 ? (
        <section className="w-full space-y-4">
          <h2 className="text-left text-xl font-semibold">Always on</h2>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((tile) => (
              <ClickTracker key={tile.id} slug={slug} tileId={tile.id} href={tile.ctaUrl}>
                <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 p-2">
                  {tile.media ? (
                    <Image
                      src={tile.media.url}
                      alt={tile.title}
                      width={400}
                      height={400}
                      className="aspect-square w-full rounded-lg object-cover"
                      unoptimized
                      sizes="(min-width: 1024px) 320px, 50vw"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center rounded-lg bg-white/10 text-lg font-semibold text-white/80">
                      {tile.title.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-center text-sm font-medium text-white truncate">{tile.title}</p>
              </ClickTracker>
            ))}
          </div>
        </section>
      ) : null}

      {/* Social links */}
      {socialLinks}
    </div>
  );
}
