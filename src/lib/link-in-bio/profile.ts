import { requireAuthContext } from "@/lib/auth/server";
import { isSchemaMissingError } from "@/lib/supabase/errors";

import type {
  LinkInBioFont,
  LinkInBioProfile,
  LinkInBioProfileWithTiles,
  LinkInBioTheme,
  LinkInBioTemplate,
  LinkInBioTile,
  ReorderLinkInBioTilesInput,
  TileType,
  UpdateLinkInBioProfileInput,
  UpsertLinkInBioTileInput,
} from "./types";

interface LinkInBioProfileRow {
  account_id: string;
  slug: string;
  display_name: string | null;
  bio: string | null;
  logo_url: string | null;
  hero_media_id: string | null;
  theme: LinkInBioTheme | null;
  phone_number: string | null;
  whatsapp_number: string | null;
  booking_url: string | null;
  menu_url: string | null;
  parking_url: string | null;
  directions_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  template: string;
  font_family: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

interface LinkInBioTileRow {
  id: string;
  account_id: string;
  title: string;
  subtitle: string | null;
  cta_label: string;
  cta_url: string;
  media_asset_id: string | null;
  tile_type: string;
  embed_data: Record<string, unknown> | null;
  position: number | null;
  enabled: boolean | null;
  created_at: string;
  updated_at: string;
}

function shapeProfile(row: LinkInBioProfileRow | null): LinkInBioProfile | null {
  if (!row) return null;

  return {
    accountId: row.account_id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    logoUrl: row.logo_url ?? null,
    heroMediaId: row.hero_media_id,
    theme: row.theme ?? {},
    phoneNumber: row.phone_number,
    whatsappNumber: row.whatsapp_number,
    bookingUrl: row.booking_url,
    menuUrl: row.menu_url,
    parkingUrl: row.parking_url,
    directionsUrl: row.directions_url,
    facebookUrl: row.facebook_url,
    instagramUrl: row.instagram_url,
    websiteUrl: row.website_url,
    template: (row.template ?? 'classic') as LinkInBioTemplate,
    fontFamily: (row.font_family ?? 'inter') as LinkInBioFont,
    isPublished: row.is_published ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies LinkInBioProfile;
}

function shapeTile(row: LinkInBioTileRow): LinkInBioTile {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    subtitle: row.subtitle,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    mediaAssetId: row.media_asset_id,
    tileType: (row.tile_type ?? 'link') as TileType,
    embedData: row.embed_data ?? null,
    position: row.position ?? 0,
    enabled: Boolean(row.enabled ?? true),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies LinkInBioTile;
}

export async function getLinkInBioProfileWithTiles(): Promise<LinkInBioProfileWithTiles> {
  const { supabase, accountId } = await requireAuthContext();

  try {
    const [profileResult, tilesResult] = await Promise.all([
      supabase
        .from("link_in_bio_profiles")
        .select(
          "account_id, slug, display_name, bio, logo_url, hero_media_id, theme, phone_number, whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url, instagram_url, website_url, template, font_family, is_published, created_at, updated_at",
        )
        .eq("account_id", accountId)
        .maybeSingle<LinkInBioProfileRow>(),
      supabase
        .from("link_in_bio_tiles")
        .select("id, account_id, title, subtitle, cta_label, cta_url, media_asset_id, tile_type, embed_data, position, enabled, created_at, updated_at")
        .eq("account_id", accountId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .returns<LinkInBioTileRow[]>(),
    ]);

    if (profileResult.error && !isSchemaMissingError(profileResult.error)) {
      throw profileResult.error;
    }

    if (tilesResult.error && !isSchemaMissingError(tilesResult.error)) {
      throw tilesResult.error;
    }

    return {
      profile: shapeProfile(profileResult.data ?? null),
      tiles: (tilesResult.data ?? []).map(shapeTile),
    };
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return { profile: null, tiles: [] };
    }
    throw error;
  }
}

export async function upsertLinkInBioProfile(input: UpdateLinkInBioProfileInput) {
  const { supabase, accountId } = await requireAuthContext();

  const payload: Partial<LinkInBioProfileRow> & { account_id: string; slug: string; updated_at: string } = {
    account_id: accountId,
    slug: input.slug,
    updated_at: new Date().toISOString(),
  };

  if ("displayName" in input) payload.display_name = input.displayName ?? null;
  if ("bio" in input) payload.bio = input.bio ?? null;
  if ("logoUrl" in input) payload.logo_url = input.logoUrl ?? null;
  if ("heroMediaId" in input) payload.hero_media_id = input.heroMediaId ?? null;
  if ("theme" in input) payload.theme = input.theme ?? {};
  if ("phoneNumber" in input) payload.phone_number = input.phoneNumber ?? null;
  if ("whatsappNumber" in input) payload.whatsapp_number = input.whatsappNumber ?? null;
  if ("bookingUrl" in input) payload.booking_url = input.bookingUrl ?? null;
  if ("menuUrl" in input) payload.menu_url = input.menuUrl ?? null;
  if ("parkingUrl" in input) payload.parking_url = input.parkingUrl ?? null;
  if ("directionsUrl" in input) payload.directions_url = input.directionsUrl ?? null;
  if ("facebookUrl" in input) payload.facebook_url = input.facebookUrl ?? null;
  if ("instagramUrl" in input) payload.instagram_url = input.instagramUrl ?? null;
  if ("websiteUrl" in input) payload.website_url = input.websiteUrl ?? null;
  if ("template" in input) payload.template = input.template ?? "classic";
  if ("fontFamily" in input) payload.font_family = input.fontFamily ?? "inter";
  if ("isPublished" in input) payload.is_published = input.isPublished ?? false;

  const { data, error } = await supabase
    .from("link_in_bio_profiles")
    .upsert(payload, { onConflict: "account_id" })
    .select(
      "account_id, slug, display_name, bio, logo_url, hero_media_id, theme, phone_number, whatsapp_number, booking_url, menu_url, parking_url, directions_url, facebook_url, instagram_url, website_url, template, font_family, is_published, created_at, updated_at",
    )
    .single<LinkInBioProfileRow>();

  if (error) {
    throw error;
  }

  return shapeProfile(data);
}

export async function createLinkInBioTile(input: UpsertLinkInBioTileInput) {
  const { supabase, accountId } = await requireAuthContext();

  const { data: maxRow, error: maxError } = await supabase
    .from("link_in_bio_tiles")
    .select("position")
    .eq("account_id", accountId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number | null }>();

  if (maxError) {
    throw maxError;
  }

  const nextPosition = (maxRow?.position ?? -1) + 1;

  const payload = {
    account_id: accountId,
    title: input.title,
    subtitle: input.subtitle ?? null,
    cta_label: input.ctaLabel,
    cta_url: input.ctaUrl,
    media_asset_id: input.mediaAssetId ?? null,
    tile_type: input.tileType ?? 'link',
    embed_data: input.embedData ?? null,
    enabled: input.enabled ?? true,
    position: nextPosition,
  } satisfies Partial<LinkInBioTileRow> & {
    account_id: string;
    title: string;
    cta_label: string;
    cta_url: string;
  };

  const { data, error } = await supabase
    .from("link_in_bio_tiles")
    .insert(payload)
    .select("id, account_id, title, subtitle, cta_label, cta_url, media_asset_id, tile_type, embed_data, position, enabled, created_at, updated_at")
    .single<LinkInBioTileRow>();

  if (error) {
    throw error;
  }

  return shapeTile(data);
}

export async function updateLinkInBioTile(tileId: string, input: UpsertLinkInBioTileInput) {
  const { supabase, accountId } = await requireAuthContext();

  const payload: Partial<LinkInBioTileRow> = {
    title: input.title,
    subtitle: input.subtitle ?? null,
    cta_label: input.ctaLabel,
    cta_url: input.ctaUrl,
    media_asset_id: input.mediaAssetId ?? null,
    updated_at: new Date().toISOString(),
  };

  if (typeof input.enabled === "boolean") {
    payload.enabled = input.enabled;
  }
  if (input.tileType !== undefined) {
    payload.tile_type = input.tileType;
  }
  if (input.embedData !== undefined) {
    payload.embed_data = input.embedData;
  }

  const { data, error } = await supabase
    .from("link_in_bio_tiles")
    .update(payload)
    .eq("id", tileId)
    .eq("account_id", accountId)
    .select("id, account_id, title, subtitle, cta_label, cta_url, media_asset_id, tile_type, embed_data, position, enabled, created_at, updated_at")
    .single<LinkInBioTileRow>();

  if (error) {
    throw error;
  }

  return shapeTile(data);
}

export async function deleteLinkInBioTile(tileId: string) {
  const { supabase, accountId } = await requireAuthContext();

  const { error } = await supabase
    .from("link_in_bio_tiles")
    .delete()
    .eq("id", tileId)
    .eq("account_id", accountId);

  if (error) {
    throw error;
  }
}

export async function reorderLinkInBioTiles(input: ReorderLinkInBioTilesInput) {
  const { supabase, accountId } = await requireAuthContext();

  if (!input.tileIdsInOrder.length) {
    return;
  }

  // Validate all tile IDs belong to the authenticated account before upsert.
  // Prevents an attacker from injecting foreign tile IDs into the reorder payload.
  const { data: ownedTiles, error: ownedError } = await supabase
    .from("link_in_bio_tiles")
    .select("id")
    .eq("account_id", accountId)
    .in("id", input.tileIdsInOrder);

  if (ownedError) {
    throw ownedError;
  }

  const ownedIds = new Set((ownedTiles ?? []).map((tile: { id: string }) => tile.id));
  const unownedIds = input.tileIdsInOrder.filter((tileId) => !ownedIds.has(tileId));
  if (unownedIds.length > 0) {
    throw new Error("One or more link-in-bio tiles were not found for this account");
  }

  const updates = input.tileIdsInOrder.map((tileId, index) => ({
    id: tileId,
    account_id: accountId,
    position: index,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("link_in_bio_tiles")
    .upsert(updates, { onConflict: "id" });

  if (error) {
    throw error;
  }
}
