/**
 * Magazine template: 2-column with large hero banner, card tiles with images, editorial feel.
 * Server component for LCP performance (PERF-03).
 * No 'Powered by CheersAI' footer (D-11).
 */

import Image from 'next/image';

import type { PublicLinkInBioPageData, PublicLinkInBioTile } from '@/lib/link-in-bio/types';
import { ClickTracker } from '../click-tracker';
import { LinkInBioLogo } from './logo-image';

interface MagazineTemplateProps {
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

function getMediaDimensions(shape: 'square' | 'story' | null | undefined) {
  if (shape === 'story') return { width: 720, height: 1280 };
  return { width: 1200, height: 900 };
}

export function MagazineTemplate({
  profile,
  tiles,
  logoMedia,
  heroMedia,
  slug,
  ctaButtons,
  campaignsSection,
  socialLinks,
}: MagazineTemplateProps) {
  const heroMediaDims = heroMedia ? getMediaDimensions(heroMedia.shape) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-10 text-center text-white">
      {/* Large hero banner */}
      {heroMedia && heroMediaDims ? (
        <div className="w-full overflow-hidden rounded-3xl border border-white/20">
          <Image
            src={heroMedia.url}
            alt="Venue highlight"
            width={heroMediaDims.width}
            height={heroMediaDims.height}
            className="h-auto w-full object-contain"
            unoptimized
            sizes="(min-width: 1024px) 768px, 100vw"
            priority
          />
        </div>
      ) : null}

      {/* Venue info */}
      <div className="flex flex-col items-center gap-3">
        <LinkInBioLogo logoMedia={logoMedia} name={profile.displayName ?? profile.slug} className="max-h-32 max-w-52" />
        <h1 className="text-3xl font-bold tracking-tight">
          {profile.displayName ?? profile.slug}
        </h1>
        {profile.bio ? (
          <p className="text-base text-white/80 max-w-lg leading-relaxed">{profile.bio}</p>
        ) : null}
      </div>

      {/* CTA buttons */}
      {ctaButtons}

      {/* Campaigns */}
      {campaignsSection}

      {/* Tiles - 2-column cards with images */}
      {tiles.length > 0 ? (
        <section className="w-full space-y-4">
          <h2 className="text-left text-xl font-semibold">Always on</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {tiles.map((tile) => {
              const tileDims = getMediaDimensions(tile.media?.shape);
              return (
                <ClickTracker key={tile.id} slug={slug} tileId={tile.id} href={tile.ctaUrl}>
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                    {tile.media ? (
                      <Image
                        src={tile.media.url}
                        alt={tile.title}
                        width={tileDims.width}
                        height={tileDims.height}
                        className="h-auto w-full object-contain"
                        unoptimized
                        sizes="(min-width: 1024px) 384px, 50vw"
                      />
                    ) : (
                      <div className="flex min-h-[140px] items-center justify-center bg-white/10 text-lg font-semibold text-white/80">
                        {tile.title.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="p-4 text-left">
                      <p className="text-base font-semibold text-white">{tile.title}</p>
                      {tile.subtitle ? <p className="mt-1 text-sm text-white/70">{tile.subtitle}</p> : null}
                      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-white/50">{tile.ctaLabel}</p>
                    </div>
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
