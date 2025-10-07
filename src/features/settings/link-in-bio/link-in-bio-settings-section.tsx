import type { MediaAssetSummary } from "@/lib/library/data";
import type { LinkInBioProfile, LinkInBioTile } from "@/lib/link-in-bio/types";

import { LinkInBioProfileForm } from "./link-in-bio-profile-form";
import { LinkInBioTileManager } from "./link-in-bio-tile-manager";

interface LinkInBioSettingsSectionProps {
  profile: LinkInBioProfile | null;
  tiles: LinkInBioTile[];
  mediaAssets: MediaAssetSummary[];
}

export function LinkInBioSettingsSection({ profile, tiles, mediaAssets }: LinkInBioSettingsSectionProps) {
  return (
    <section className="space-y-8 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
      <header className="space-y-2">
        <h3 className="text-2xl font-semibold">Link in bio</h3>
        <p className="text-sm text-brand-teal/70">
          Control the public page guests land on from Instagram. Configure colours, CTAs, evergreen tiles, and hero media.
        </p>
      </header>
      <LinkInBioProfileForm profile={profile} mediaAssets={mediaAssets} />
      <div className="border-t border-brand-teal/20 pt-6">
        <LinkInBioTileManager tiles={tiles} mediaAssets={mediaAssets} />
      </div>
    </section>
  );
}
