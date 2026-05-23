'use client';

/**
 * Phone-frame preview for the link-in-bio editor (D-02).
 * Shows a 375px-wide phone mockup with scaled-down preview
 * of the public page using the selected template layout.
 * Hidden on mobile (editor is full-width); visible on desktop (lg:).
 */

import { TEMPLATES } from '@/lib/link-in-bio/templates';
import { cn } from '@/lib/utils';
import type { LinkInBioProfile, LinkInBioTile } from '@/lib/link-in-bio/types';

interface PhonePreviewProps {
  profile: LinkInBioProfile;
  tiles: LinkInBioTile[];
}

function PreviewTile({ tile, tileStyle }: { tile: LinkInBioTile; tileStyle: 'card' | 'list' | 'grid' }) {
  if (tileStyle === 'list') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2.5">
        <div className="h-6 w-6 rounded bg-white/10 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium text-white truncate">{tile.title}</p>
        </div>
      </div>
    );
  }

  if (tileStyle === 'grid') {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="aspect-square w-full rounded bg-white/10 mb-1.5" />
        <p className="text-[9px] font-medium text-white truncate">{tile.title}</p>
      </div>
    );
  }

  // card style
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
      <div className="h-16 w-full rounded bg-white/10 mb-2" />
      <p className="text-[10px] font-medium text-white truncate">{tile.title}</p>
      {tile.subtitle ? (
        <p className="text-[8px] text-white/60 truncate">{tile.subtitle}</p>
      ) : null}
    </div>
  );
}

export function PhonePreview({ profile, tiles }: PhonePreviewProps) {
  const template = TEMPLATES[profile.template] ?? TEMPLATES.classic;
  const theme = profile.theme ?? {};
  const primaryColor = typeof theme.primaryColor === 'string' && theme.primaryColor.length
    ? theme.primaryColor
    : '#005131';
  const secondaryColor = typeof theme.secondaryColor === 'string' && theme.secondaryColor.length
    ? theme.secondaryColor
    : '#a57626';
  const quickActionLayout = theme.quickActionLayout === 'single' ? 'single' : 'double';

  const enabledTiles = tiles.filter((t) => t.enabled);
  const quickActions = [
    { key: 'phone', label: 'Call us', enabled: Boolean(profile.phoneNumber) },
    { key: 'directionsUrl', label: 'Find us', enabled: Boolean(profile.directionsUrl) },
    { key: 'whatsapp', label: 'WhatsApp us', enabled: Boolean(profile.whatsappNumber) },
    { key: 'bookingUrl', label: 'Book a table', enabled: Boolean(profile.bookingUrl) },
    { key: 'menuUrl', label: 'See our menu', enabled: Boolean(profile.menuUrl) },
  ].filter((action) => action.enabled);

  return (
    <div className="hidden lg:flex items-start justify-center">
      {/* Phone frame */}
      <div
        className="relative overflow-hidden rounded-[2.5rem] border-4 border-gray-800 bg-gray-800 shadow-2xl"
        style={{ width: 375, height: 700 }}
      >
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 h-6 w-32 rounded-b-2xl bg-gray-800" />

        {/* Content area */}
        <div
          className="h-full w-full overflow-y-auto pt-8 pb-4 px-4"
          style={{ backgroundColor: primaryColor }}
        >
          <div className="flex flex-col items-center gap-4 text-center text-white">
            {/* Hero */}
            {template.heroStyle !== 'none' ? (
              <div
                className={
                  template.heroStyle === 'banner'
                    ? 'h-20 w-full rounded-lg bg-white/10'
                    : 'h-16 w-16 rounded-lg bg-white/10'
                }
              />
            ) : null}

            {/* Logo placeholder */}
            <div className="h-14 w-14 rounded-full bg-white/20" />

            {/* Name */}
            {!profile.logoUrl ? (
              <p className="text-sm font-semibold">
                {profile.displayName || 'Your Venue'}
              </p>
            ) : null}

            {/* Bio */}
            {template.showBio && profile.bio ? (
              <p className="text-[10px] text-white/70 line-clamp-2 max-w-[280px]">
                {profile.bio}
              </p>
            ) : null}

            {/* CTA buttons preview */}
            {quickActions.length ? (
              <div
                className={cn(
                  "grid w-full gap-1.5",
                  quickActionLayout === 'single' ? 'grid-cols-1' : 'grid-cols-2',
                )}
              >
                {quickActions.map((action) => (
                  <div
                    key={action.key}
                    className={cn(
                      "rounded px-2 py-1 text-[8px] font-medium text-white",
                      quickActionLayout === 'double' && action.key === 'menuUrl' && 'col-span-2',
                    )}
                    style={{ backgroundColor: secondaryColor }}
                  >
                    {action.label}
                  </div>
                ))}
              </div>
            ) : null}

            {/* Tiles */}
            {enabledTiles.length > 0 ? (
              <div
                className={
                  template.tileColumns === 1
                    ? 'w-full space-y-2'
                    : `w-full grid gap-2 ${template.tileColumns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`
                }
              >
                {enabledTiles.slice(0, 6).map((tile) => (
                  <PreviewTile
                    key={tile.id}
                    tile={tile}
                    tileStyle={template.tileStyle}
                  />
                ))}
                {enabledTiles.length > 6 ? (
                  <p className="text-[8px] text-white/50 text-center col-span-full">
                    +{enabledTiles.length - 6} more tiles
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
