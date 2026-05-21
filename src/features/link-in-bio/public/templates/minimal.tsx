/**
 * Minimal template: single column, no hero, list-style tiles, minimal branding.
 * Server component for LCP performance (PERF-03).
 * No 'Powered by CheersAI' footer (D-11).
 */

import type { PublicLinkInBioPageData, PublicLinkInBioTile } from '@/lib/link-in-bio/types';
import { ClickTracker } from '../click-tracker';
import { LinkInBioLogo } from './logo-image';

interface MinimalTemplateProps {
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

export function MinimalTemplate({
  profile,
  tiles,
  logoMedia,
  slug,
  ctaButtons,
  campaignsSection,
  socialLinks,
}: MinimalTemplateProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-8 text-center text-white">
      {/* No hero image in minimal template */}

      <LinkInBioLogo logoMedia={logoMedia} name={profile.displayName ?? profile.slug} className="max-h-20 max-w-36" />

      {/* Venue name only - no bio in minimal */}
      <h1 className="text-xl font-semibold">
        {profile.displayName ?? profile.slug}
      </h1>

      {/* CTA buttons */}
      {ctaButtons}

      {/* Campaigns */}
      {campaignsSection}

      {/* Tiles - list style */}
      {tiles.length > 0 ? (
        <section className="w-full space-y-2">
          {tiles.map((tile) => (
            <ClickTracker key={tile.id} slug={slug} tileId={tile.id} href={tile.ctaUrl}>
              <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10">
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-white truncate">{tile.title}</p>
                  {tile.subtitle ? (
                    <p className="text-xs text-white/60 truncate">{tile.subtitle}</p>
                  ) : null}
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-shrink-0 text-white/40"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </ClickTracker>
          ))}
        </section>
      ) : null}

      {/* Social links */}
      {socialLinks}
    </div>
  );
}
