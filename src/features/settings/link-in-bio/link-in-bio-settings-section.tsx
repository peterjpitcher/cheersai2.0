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
    <section className="space-y-8">
      <header className="space-y-2">
        <h3 className="text-2xl font-semibold" style={{ color: "var(--c-ink)" }}>Link in bio</h3>
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          Control the public page guests land on from Instagram. Configure colours, logo, CTAs, evergreen tiles, and hero media.
        </p>
      </header>
      <LinkInBioProfileForm profile={profile} mediaAssets={mediaAssets} />
      <div className="pt-6" style={{ borderTop: "1px solid var(--c-line)" }}>
        <LinkInBioTileManager tiles={tiles} mediaAssets={mediaAssets} />
      </div>
    </section>
  );
}
