"use server";

import { revalidatePath } from "next/cache";

import {
  brandProfileFormSchema,
  postingDefaultsFormSchema,
  linkInBioProfileFormSchema,
  linkInBioTileFormSchema,
  linkInBioTileReorderSchema,
} from "@/features/settings/schema";
import { requireAuthContext } from "@/lib/auth/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  createLinkInBioTile,
  deleteLinkInBioTile,
  reorderLinkInBioTiles,
  updateLinkInBioTile,
  upsertLinkInBioProfile,
} from "@/lib/link-in-bio/profile";

export async function updateBrandProfile(formData: unknown) {
  const parsed = brandProfileFormSchema.parse(formData);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  await supabase
    .from("brand_profile")
    .upsert(
      {
        account_id: accountId,
        tone_formal: parsed.toneFormal,
        tone_playful: parsed.tonePlayful,
        key_phrases: parsed.keyPhrases,
        banned_topics: parsed.bannedTopics,
        default_hashtags: parsed.defaultHashtags,
        default_emojis: parsed.defaultEmojis,
        instagram_signature: parsed.instagramSignature,
        facebook_signature: parsed.facebookSignature,
        gbp_cta: parsed.gbpCta,
      },
      { onConflict: "account_id" },
    )
    .throwOnError();

  revalidatePath("/settings");
}

export async function updateLinkInBioProfileSettings(formData: unknown) {
  const parsed = linkInBioProfileFormSchema.parse(formData);

  await upsertLinkInBioProfile({
    slug: parsed.slug,
    displayName: parsed.displayName ?? null,
    bio: parsed.bio ?? null,
    heroMediaId: parsed.heroMediaId ?? null,
    theme: {
      primaryColor: parsed.theme.primaryColor,
      secondaryColor: parsed.theme.secondaryColor,
    },
    phoneNumber: parsed.phoneNumber ?? null,
    whatsappNumber: parsed.whatsappNumber ?? null,
    bookingUrl: parsed.bookingUrl ?? null,
    menuUrl: parsed.menuUrl ?? null,
    parkingUrl: parsed.parkingUrl ?? null,
    facebookUrl: parsed.facebookUrl ?? null,
    instagramUrl: parsed.instagramUrl ?? null,
    websiteUrl: parsed.websiteUrl ?? null,
  });

  revalidatePath("/settings");
}

export async function upsertLinkInBioTileSettings(formData: unknown) {
  const parsed = linkInBioTileFormSchema.parse(formData);

  if (parsed.id) {
    await updateLinkInBioTile(parsed.id, {
      title: parsed.title,
      subtitle: parsed.subtitle ?? null,
      ctaLabel: parsed.ctaLabel,
      ctaUrl: parsed.ctaUrl,
      mediaAssetId: parsed.mediaAssetId ?? null,
      enabled: parsed.enabled,
    });
  } else {
    await createLinkInBioTile({
      title: parsed.title,
      subtitle: parsed.subtitle ?? null,
      ctaLabel: parsed.ctaLabel,
      ctaUrl: parsed.ctaUrl,
      mediaAssetId: parsed.mediaAssetId ?? null,
      enabled: parsed.enabled,
    });
  }

  revalidatePath("/settings");
}

export async function removeLinkInBioTile(tileId: string) {
  await deleteLinkInBioTile(tileId);
  revalidatePath("/settings");
}

export async function reorderLinkInBioTilesSettings(formData: unknown) {
  const parsed = linkInBioTileReorderSchema.parse(formData);
  await reorderLinkInBioTiles({ tileIdsInOrder: parsed.tileIds });
  revalidatePath("/settings");
}

export async function updatePostingDefaults(formData: unknown) {
  const parsed = postingDefaultsFormSchema.parse(formData);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  await supabase
    .from("accounts")
    .update({ timezone: parsed.timezone })
    .eq("id", accountId)
    .throwOnError();

  await supabase
    .from("posting_defaults")
    .upsert(
      {
        account_id: accountId,
        facebook_location_id: parsed.facebookLocationId ?? null,
        instagram_location_id: parsed.instagramLocationId ?? null,
        gbp_location_id: parsed.gbpLocationId ?? null,
        notifications: {
          emailFailures: parsed.notifications.emailFailures,
          emailTokenExpiring: parsed.notifications.emailTokenExpiring,
        },
        gbp_cta_standard: parsed.gbpCtaDefaults.standard,
        gbp_cta_event: parsed.gbpCtaDefaults.event,
        gbp_cta_offer: parsed.gbpCtaDefaults.offer,
      },
      { onConflict: "account_id" },
    )
    .throwOnError();

  revalidatePath("/settings");
}
