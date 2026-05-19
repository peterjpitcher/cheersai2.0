/**
 * Classic template: full-width banner hero, centred logo, single-column tile cards.
 * Server component for LCP performance (PERF-03).
 * No 'Powered by CheersAI' footer (D-11).
 */

import Image from 'next/image';

import type { PublicLinkInBioPageData, PublicLinkInBioTile } from '@/lib/link-in-bio/types';
import { ClickTracker } from '../click-tracker';

interface ClassicTemplateProps {
  profile: PublicLinkInBioPageData['profile'];
  tiles: PublicLinkInBioTile[];
  campaigns: PublicLinkInBioPageData['campaigns'];
  heroMedia: PublicLinkInBioPageData['heroMedia'];
  slug: string;
  ctaButtons: React.ReactNode;
  campaignsSection: React.ReactNode;
  socialLinks: React.ReactNode;
}

function getMediaDimensions(shape: 'square' | 'story' | null | undefined) {
  if (shape === 'story') return { width: 720, height: 1280 };
  return { width: 1200, height: 900 };
}

export function ClassicTemplate({
  profile,
  tiles,
  heroMedia,
  slug,
  ctaButtons,
  campaignsSection,
  socialLinks,
}: ClassicTemplateProps) {
  const heroMediaDims = heroMedia ? getMediaDimensions(heroMedia.shape) : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-10 text-center text-white">
      {/* Hero banner */}
      {heroMedia && heroMediaDims ? (
        <div className="w-full overflow-hidden rounded-3xl border border-white/20 bg-white/5 p-3">
          <Image
            src={heroMedia.url}
            alt="Venue highlight"
            width={heroMediaDims.width}
            height={heroMediaDims.height}
            className="mx-auto h-auto w-full rounded-2xl object-contain"
            unoptimized
            sizes="(min-width: 1024px) 640px, 100vw"
            priority
          />
        </div>
      ) : null}

      {/* Venue info */}
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-2xl font-bold">
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

      {/* Tiles - single column cards */}
      {tiles.length > 0 ? (
        <section className="w-full space-y-4">
          <h2 className="text-left text-xl font-semibold">Always on</h2>
          <div className="flex flex-col gap-4">
            {tiles.map((tile) => {
              const tileDims = getMediaDimensions(tile.media?.shape);
              return (
                <ClickTracker key={tile.id} slug={slug} tileId={tile.id} href={tile.ctaUrl}>
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2">
                    {tile.media ? (
                      <Image
                        src={tile.media.url}
                        alt={tile.title}
                        width={tileDims.width}
                        height={tileDims.height}
                        className="mx-auto h-auto w-full rounded-xl object-contain"
                        unoptimized
                        sizes="(min-width: 1024px) 640px, 100vw"
                      />
                    ) : (
                      <div className="flex min-h-[120px] items-center justify-center rounded-2xl bg-white/10 text-lg font-semibold text-white/80">
                        {tile.title.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 text-left">
                    <p className="text-base font-semibold text-white">{tile.title}</p>
                    {tile.subtitle ? <p className="text-sm text-white/70">{tile.subtitle}</p> : null}
                    <p className="mt-2 text-xs uppercase tracking-wide text-white/60">{tile.ctaLabel}</p>
                  </div>
                </ClickTracker>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Social links */}
      {socialLinks}
    </div>
  );
}
