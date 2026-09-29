"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  brandProfileFormSchema,
  managementConnectionFormSchema,
  postingDefaultsFormSchema,
  linkInBioProfileFormSchema,
  linkInBioTileFormSchema,
  linkInBioTileReorderSchema,
} from "@/features/settings/schema";
import { checkManagementConnection } from "@/lib/management-app/connection-check";
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  createLinkInBioTile,
  deleteLinkInBioTile,
  getLinkInBioProfileWithTiles,
  reorderLinkInBioTiles,
  updateLinkInBioTile,
  upsertLinkInBioProfile,
} from "@/lib/link-in-bio/profile";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import { ManagementApiError } from "@/lib/management-app/client";
import {
  getManagementConnectionConfig,
  MANAGEMENT_CONNECTION_SCHEMA_MISSING_MESSAGE,
  saveManagementConnection,
  updateManagementConnectionTestResult,
} from "@/lib/management-app/data";

const logger = createLogger("settings");

async function revalidateCurrentLinkInBioPage() {
  const { profile } = await getLinkInBioProfileWithTiles();
  if (profile?.slug) {
    revalidatePath(`/l/${profile.slug}`);
  }
}

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
        banned_phrases: parsed.bannedPhrases,
        default_hashtags: parsed.defaultHashtags,
        default_emojis: parsed.defaultEmojis,
        instagram_signature: parsed.instagramSignature,
        facebook_signature: parsed.facebookSignature,
        // Empty means "not set", stored as null so the AI keeps its default pub style.
        business_type: parsed.businessType || null,
        business_description: parsed.businessDescription || null,
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
    logoUrl: parsed.logoUrl ?? null,
    heroMediaId: parsed.heroMediaId ?? null,
    theme: {
      primaryColor: parsed.theme.primaryColor,
      secondaryColor: parsed.theme.secondaryColor,
      quickActionLayout: parsed.theme.quickActionLayout,
    },
    phoneNumber: parsed.phoneNumber ?? null,
    whatsappNumber: parsed.whatsappNumber ?? null,
    bookingUrl: parsed.bookingUrl ?? null,
    menuUrl: parsed.menuUrl ?? null,
    parkingUrl: parsed.parkingUrl ?? null,
    directionsUrl: parsed.directionsUrl ?? null,
    facebookUrl: parsed.facebookUrl ?? null,
    instagramUrl: parsed.instagramUrl ?? null,
    websiteUrl: parsed.websiteUrl ?? null,
  });

  revalidatePath("/settings");
  revalidatePath(`/l/${parsed.slug}`);
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
  await revalidateCurrentLinkInBioPage();
}

export async function removeLinkInBioTile(tileId: string) {
  await deleteLinkInBioTile(tileId);
  revalidatePath("/settings");
  await revalidateCurrentLinkInBioPage();
}

export async function reorderLinkInBioTilesSettings(formData: unknown) {
  const parsed = linkInBioTileReorderSchema.parse(formData);
  await reorderLinkInBioTiles({ tileIdsInOrder: parsed.tileIds });
  revalidatePath("/settings");
  await revalidateCurrentLinkInBioPage();
}

export async function updatePostingDefaults(formData: unknown) {
  const parsed = postingDefaultsFormSchema.parse(formData);
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const venueLocation = parsed.venueLocation?.trim() || null;
  const defaultEventVenue = parsed.defaultEventVenue?.trim() || null;
  const venueLatitude = parseOptionalCoordinate(parsed.venueLatitude);
  const venueLongitude = parseOptionalCoordinate(parsed.venueLongitude);

  await supabase
    .from("accounts")
    .update({ timezone: DEFAULT_TIMEZONE })
    .eq("id", accountId)
    .throwOnError();

  await supabase
    .from("posting_defaults")
    .upsert(
      {
        account_id: accountId,
        facebook_location_id: parsed.facebookLocationId ?? null,
        instagram_location_id: parsed.instagramLocationId ?? null,
        default_posting_time: parsed.defaultPostingTime ?? null,
        venue_location: venueLocation,
        default_event_venue: defaultEventVenue,
        venue_latitude: venueLatitude,
        venue_longitude: venueLongitude,
        notifications: {
          emailFailures: parsed.notifications.emailFailures,
          emailTokenExpiring: parsed.notifications.emailTokenExpiring,
        },
        banners_enabled: parsed.bannerDefaults.bannersEnabled,
        banner_position: parsed.bannerDefaults.bannerPosition,
        banner_bg: parsed.bannerDefaults.bannerBg,
        banner_text_colour: parsed.bannerDefaults.bannerTextColour,
      },
      { onConflict: "account_id" },
    )
    .throwOnError();

  revalidatePath("/settings");
}

function parseOptionalCoordinate(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function updateManagementConnectionSettings(formData: unknown) {
  const parsed = managementConnectionFormSchema.parse(formData);
  const summary = await saveManagementConnection({
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    enabled: parsed.enabled,
  });

  revalidatePath("/settings");
  return summary;
}

export async function testManagementConnectionSettings() {
  try {
    const config = await getManagementConnectionConfig();
    const message = await checkManagementConnection(config);
    const summary = await updateManagementConnectionTestResult({
      status: "ok",
      message,
    });

    revalidatePath("/settings");
    return {
      ok: true as const,
      message,
      summary,
    };
  } catch (error) {
    unstable_rethrow(error);
    const message = describeManagementConnectionError(error);

    try {
      await updateManagementConnectionTestResult({
        status: "error",
        message,
      });
    } catch (recordError) {
      unstable_rethrow(recordError);
      // Ignore if the connection row has not been created yet.
    }

    revalidatePath("/settings");
    return {
      ok: false as const,
      message,
    };
  }
}

function describeManagementConnectionError(error: unknown): string {
  if (error instanceof ManagementApiError) {
    if (error.code === "UNAUTHORIZED") {
      return "Management API rejected the credentials. Check the API key.";
    }
    if (error.code === "FORBIDDEN") {
      return "Management API key is missing required permissions (read:events/read:menu/read:events:artwork).";
    }
    if (error.code === "RATE_LIMITED") {
      return "Management API rate limit exceeded. Try again shortly.";
    }
    if (error.code === "NETWORK") {
      return "Management API is unreachable. Check the base URL and network access.";
    }
  }

  // The messages above, and the connection check's own, were written for the
  // person entering the Base URL and API key. Anything else (the management
  // API's or the database's own text) goes to the log, not the page
  // (tasks/SPEC-plain-error-messages.md).
  if (error instanceof Error && MANAGEMENT_TEST_MESSAGES.has(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.message === MANAGEMENT_CONNECTION_SCHEMA_MISSING_MESSAGE) {
    logger.error("management connection test: schema missing", error);
    return "The management app connection is not set up for this brand yet. Please contact Cheers support.";
  }

  logger.error("management connection test failed", toLoggableError(error));
  return "The connection test failed. Check the Base URL and API key, then try again.";
}

/** Thrown by getManagementConnectionConfig and checkManagementConnection for the person setting it up. */
const MANAGEMENT_TEST_MESSAGES = new Set([
  "Management app connection is not configured.",
  "Management app connection is disabled.",
  "Event artwork access failed. The API key needs read:events:artwork permission.",
  "Event artwork could not be checked. Check the management artwork API.",
]);
