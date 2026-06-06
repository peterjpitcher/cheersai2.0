import {
  createManagementMetaAdsLink,
  ManagementApiError,
  type ManagementMetaAdsLinkVariant,
  type ManagementMetaAdsLinkVariantInput,
} from '@/lib/management-app/client';
import { getManagementConnectionConfig } from '@/lib/management-app/data';
import type { AiCampaignPayload } from '@/types/campaigns';

const TRUSTED_SHORT_LINK_HOSTS = new Set(['l.the-anchor.pub', 'vip-club.uk', 'www.vip-club.uk']);

export interface ManagementTrackingAd {
  name: string;
  angle?: string | null;
  creative_format?: string | null;
  creative_variant_key?: string | null;
  utm_content_key?: string | null;
}

export interface ManagementTrackingAdSet {
  name: string;
  ads: ManagementTrackingAd[];
}

export interface ManagementMetaAdVariantRequest {
  utmContent: string;
  name: string;
  metadata: Record<string, unknown>;
}

export function collectManagementMetaAdVariantsFromPayload(
  payload: AiCampaignPayload,
): ManagementMetaAdVariantRequest[] {
  return collectManagementMetaAdVariants({
    campaignName: payload.campaign_name,
    adSets: payload.ad_sets.map((adSet) => ({
      name: adSet.name,
      ads: adSet.ads,
    })),
  });
}

export function collectManagementMetaAdVariants(args: {
  campaignName: string;
  adSets: ManagementTrackingAdSet[];
}): ManagementMetaAdVariantRequest[] {
  const variants = new Map<string, ManagementMetaAdVariantRequest>();

  for (const adSet of args.adSets) {
    for (const ad of adSet.ads ?? []) {
      const utmContent = normaliseUtmContent(ad.utm_content_key);
      if (!utmContent || variants.has(utmContent)) continue;

      variants.set(utmContent, {
        utmContent,
        name: `${args.campaignName} / ${adSet.name} / ${ad.name}`.slice(0, 160),
        metadata: {
          campaign_name: args.campaignName,
          ad_set_name: adSet.name,
          ad_name: ad.name,
          angle: ad.angle ?? null,
          creative_format: ad.creative_format ?? null,
          creative_variant_key: ad.creative_variant_key ?? null,
          utm_content_key: utmContent,
        },
      });
    }
  }

  return Array.from(variants.values());
}

export async function ensureManagementMetaAdVariantLinks(args: {
  campaignKind: string | null | undefined;
  campaignName: string;
  destinationUrl: string;
  sourceSnapshot?: Record<string, unknown> | null;
  variants: ManagementMetaAdVariantRequest[];
}): Promise<Record<string, unknown>> {
  const snapshot = { ...(args.sourceSnapshot ?? {}) };
  const requestedVariants = args.variants.filter((variant) => normaliseUtmContent(variant.utmContent));
  if (requestedVariants.length === 0) return snapshot;

  const existingByUtm = managementMetaAdVariantsByUtmContent(snapshot);
  const missingVariants = requestedVariants.filter((variant) => !existingByUtm.has(variant.utmContent));
  if (missingVariants.length === 0) return snapshot;

  const parentShortCode =
    stringValue(snapshot.shortCode) ??
    extractTrustedShortCode(stringValue(snapshot.paidCtaUrl)) ??
    extractTrustedShortCode(stringValue(snapshot.metaAdsShortLink)) ??
    extractTrustedShortCode(args.destinationUrl);
  const parentDestinationUrl =
    stringValue(snapshot.metaAdsDestinationUrl) ??
    stringValue(snapshot.utmDestinationUrl) ??
    stringValue(snapshot.originalDestinationUrl) ??
    args.destinationUrl;

  try {
    const config = await getManagementConnectionConfig();
    const link = await createManagementMetaAdsLink(config, {
      destinationUrl: parentDestinationUrl,
      campaignName: args.campaignName,
      eventId: stringValue(snapshot.eventId),
      parentShortCode,
      variants: missingVariants.map(toManagementVariantInput),
      metadata: {
        campaign_kind: args.campaignKind ?? null,
        source_type: snapshot.sourceType ?? null,
        source_id: snapshot.sourceId ?? null,
      },
    });

    const mergedVariants = new Map(existingByUtm);
    for (const variant of link.variants) {
      mergedVariants.set(variant.utmContent, variant);
    }

    return {
      ...snapshot,
      shortCode: stringValue(snapshot.shortCode) ?? link.shortCode,
      paidCtaUrl: stringValue(snapshot.paidCtaUrl) ?? link.shortUrl,
      utmDestinationUrl: stringValue(snapshot.utmDestinationUrl) ?? link.utmDestinationUrl,
      managementMetaAdsLink: {
        shortUrl: link.shortUrl,
        shortCode: link.shortCode,
        destinationUrl: link.destinationUrl,
        utmDestinationUrl: link.utmDestinationUrl,
        alreadyExists: link.alreadyExists,
      },
      managementMetaAdVariants: Array.from(mergedVariants.values()),
    };
  } catch (error) {
    throw mapManagementTrackingError(error);
  }
}

export function resolveManagementMetaAdVariantShortUrl(
  sourceSnapshot: Record<string, unknown> | null | undefined,
  utmContent: string | null | undefined,
): string | null {
  const key = normaliseUtmContent(utmContent);
  if (!key) return null;
  return managementMetaAdVariantsByUtmContent(sourceSnapshot).get(key)?.shortUrl ?? null;
}

function toManagementVariantInput(variant: ManagementMetaAdVariantRequest): ManagementMetaAdsLinkVariantInput {
  return {
    utmContent: variant.utmContent,
    name: variant.name,
    metadata: variant.metadata,
  };
}

function managementMetaAdVariantsByUtmContent(
  sourceSnapshot: Record<string, unknown> | null | undefined,
): Map<string, ManagementMetaAdsLinkVariant> {
  const variants = Array.isArray(sourceSnapshot?.managementMetaAdVariants)
    ? sourceSnapshot.managementMetaAdVariants
    : [];
  const map = new Map<string, ManagementMetaAdsLinkVariant>();

  for (const value of variants) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const utmContent = normaliseUtmContent(row.utmContent ?? row.utm_content);
    const shortUrl = stringValue(row.shortUrl) ?? stringValue(row.short_url);
    const shortCode = stringValue(row.shortCode) ?? stringValue(row.short_code);
    const destinationUrl = stringValue(row.destinationUrl) ?? stringValue(row.destination_url);
    const utmDestinationUrl = stringValue(row.utmDestinationUrl) ?? stringValue(row.utm_destination_url);
    const parentShortCode = stringValue(row.parentShortCode) ?? stringValue(row.parent_short_code);

    if (!utmContent || !shortUrl || !shortCode || !destinationUrl || !utmDestinationUrl || !parentShortCode) {
      continue;
    }

    map.set(utmContent, {
      shortUrl,
      shortCode,
      destinationUrl,
      utmDestinationUrl,
      utmContent,
      parentShortCode,
      alreadyExists: Boolean(row.alreadyExists ?? row.already_exists),
    });
  }

  return map;
}

function extractTrustedShortCode(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (!TRUSTED_SHORT_LINK_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    const [code] = parsed.pathname.split('/').filter(Boolean);
    return code?.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function normaliseUtmContent(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapManagementTrackingError(error: unknown): Error {
  if (error instanceof ManagementApiError) {
    if (error.code === 'UNAUTHORIZED') {
      return new Error('Management API rejected the stored credentials, so central campaign click links could not be created.');
    }
    if (error.code === 'FORBIDDEN') {
      return new Error('Management API key is missing the permissions needed to create central campaign click links.');
    }
    if (error.code === 'NETWORK') {
      return new Error('Management API is unreachable, so central campaign click links could not be created.');
    }
    return new Error(error.message);
  }

  return error instanceof Error ? error : new Error('Failed to create central campaign click links.');
}
