"use server";

import { revalidatePath } from "next/cache";

import {
  brandProfileFormSchema,
  postingDefaultsFormSchema,
} from "@/features/settings/schema";
import { requireAuthContext } from "@/lib/auth/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

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
