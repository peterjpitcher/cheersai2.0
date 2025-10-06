import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export interface BrandProfile {
  toneFormal: number;
  tonePlayful: number;
  keyPhrases: string[];
  bannedTopics: string[];
  defaultHashtags: string[];
  defaultEmojis: string[];
  instagramSignature?: string;
  facebookSignature?: string;
  gbpCta?: string;
}

export interface PostingDefaults {
  timezone: string;
  facebookLocationId?: string;
  instagramLocationId?: string;
  gbpLocationId?: string;
  notifications: {
    emailFailures: boolean;
    emailTokenExpiring: boolean;
  };
  gbpCtaDefaults: {
    standard: "LEARN_MORE" | "BOOK" | "CALL";
    event: "LEARN_MORE" | "BOOK" | "CALL";
    offer: "REDEEM" | "CALL" | "LEARN_MORE";
  };
}

export interface OwnerSettings {
  brand: BrandProfile;
  posting: PostingDefaults;
}

type BrandProfileRow = {
  tone_formal: number | null;
  tone_playful: number | null;
  key_phrases: string[] | null;
  banned_topics: string[] | null;
  default_hashtags: string[] | null;
  default_emojis: string[] | null;
  instagram_signature: string | null;
  facebook_signature: string | null;
  gbp_cta: string | null;
};

type PostingDefaultsRow = {
  facebook_location_id: string | null;
  instagram_location_id: string | null;
  gbp_location_id: string | null;
  notifications: Record<string, boolean> | null;
  gbp_cta_standard: string;
  gbp_cta_event: string;
  gbp_cta_offer: string;
};

type AccountRow = {
  timezone: string | null;
};

export async function getOwnerSettings(): Promise<OwnerSettings> {
  const { supabase, accountId } = await requireAuthContext();

  const defaultBrand: BrandProfile = {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [],
    bannedTopics: [],
    defaultHashtags: [],
    defaultEmojis: [],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: "LEARN_MORE",
  };

  const { data: accountRow, error: accountError } = await supabase
    .from("accounts")
    .select("timezone")
    .eq("id", accountId)
    .maybeSingle<AccountRow>();

  if (accountError && !isSchemaMissingError(accountError)) {
    throw accountError;
  }

  const timezone = accountRow?.timezone ?? DEFAULT_TIMEZONE;
  const defaultPosting = createDefaultPosting(timezone);

  try {
    const { data: brandRow, error: brandError } = await supabase
      .from("brand_profile")
      .select(
        "tone_formal, tone_playful, key_phrases, banned_topics, default_hashtags, default_emojis, instagram_signature, facebook_signature, gbp_cta",
      )
      .eq("account_id", accountId)
      .maybeSingle<BrandProfileRow>();

    if (brandError) {
      if (isSchemaMissingError(brandError)) {
        return { brand: defaultBrand, posting: defaultPosting };
      }
      throw brandError;
    }

    const { data: postingRow, error: postingError } = await supabase
      .from("posting_defaults")
      .select(
        "facebook_location_id, instagram_location_id, gbp_location_id, notifications, gbp_cta_standard, gbp_cta_event, gbp_cta_offer",
      )
      .eq("account_id", accountId)
      .maybeSingle<PostingDefaultsRow>();

    if (postingError) {
      if (isSchemaMissingError(postingError)) {
        return { brand: defaultBrand, posting: defaultPosting };
      }
      throw postingError;
    }

    const notifications = postingRow?.notifications ?? defaultPosting.notifications;

    const brand: BrandProfile = {
      toneFormal: brandRow?.tone_formal ?? defaultBrand.toneFormal,
      tonePlayful: brandRow?.tone_playful ?? defaultBrand.tonePlayful,
      keyPhrases: brandRow?.key_phrases ?? defaultBrand.keyPhrases,
      bannedTopics: brandRow?.banned_topics ?? defaultBrand.bannedTopics,
      defaultHashtags: brandRow?.default_hashtags ?? defaultBrand.defaultHashtags,
      defaultEmojis: brandRow?.default_emojis ?? defaultBrand.defaultEmojis,
      instagramSignature: brandRow?.instagram_signature ?? defaultBrand.instagramSignature,
      facebookSignature: brandRow?.facebook_signature ?? defaultBrand.facebookSignature,
      gbpCta: brandRow?.gbp_cta ?? defaultBrand.gbpCta,
    };

    const posting: PostingDefaults = {
      timezone,
      facebookLocationId: postingRow?.facebook_location_id ?? undefined,
      instagramLocationId: postingRow?.instagram_location_id ?? undefined,
      gbpLocationId: postingRow?.gbp_location_id ?? undefined,
      notifications: {
        emailFailures: Boolean(notifications?.emailFailures ?? defaultPosting.notifications.emailFailures),
        emailTokenExpiring: Boolean(notifications?.emailTokenExpiring ?? defaultPosting.notifications.emailTokenExpiring),
      },
      gbpCtaDefaults: {
        standard:
          (postingRow?.gbp_cta_standard as PostingDefaults["gbpCtaDefaults"]["standard"]) ?? defaultPosting.gbpCtaDefaults.standard,
        event:
          (postingRow?.gbp_cta_event as PostingDefaults["gbpCtaDefaults"]["event"]) ?? defaultPosting.gbpCtaDefaults.event,
        offer:
          (postingRow?.gbp_cta_offer as PostingDefaults["gbpCtaDefaults"]["offer"]) ?? defaultPosting.gbpCtaDefaults.offer,
      },
    };

    return { brand, posting };
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return { brand: defaultBrand, posting: defaultPosting };
    }
    throw error;
  }
}

function createDefaultPosting(timezone: string): PostingDefaults {
  return {
    timezone,
    notifications: {
      emailFailures: true,
      emailTokenExpiring: true,
    },
    gbpCtaDefaults: {
      standard: "LEARN_MORE",
      event: "LEARN_MORE",
      offer: "REDEEM",
    },
  };
}
