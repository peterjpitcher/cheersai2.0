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
    <section className="space-y-8 rounded-xl border border-white/20 bg-white/60 p-6 text-foreground shadow-sm backdrop-blur-sm dark:bg-slate-900/60">
      <header className="space-y-2">
        <h3 className="text-2xl font-semibold">Link in bio</h3>
        <p className="text-sm text-muted-foreground">
          Control the public page guests land on from Instagram. Configure colours, CTAs, evergreen tiles, and hero media.
        </p>
      </header>
      <LinkInBioProfileForm profile={profile} mediaAssets={mediaAssets} />
      <div className="border-t border-white/30 pt-6 dark:border-slate-800/70">
        <LinkInBioTileManager tiles={tiles} mediaAssets={mediaAssets} />
      </div>
    </section>
  );
}
