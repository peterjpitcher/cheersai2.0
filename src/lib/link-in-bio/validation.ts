/**
 * Zod validation schemas for link-in-bio editor forms.
 * Slug validation runs on save only -- not live debounce (D-05).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

export const slugSchema = z
  .string()
  .min(3, 'Slug must be at least 3 characters')
  .max(40, 'Slug must be at most 40 characters')
  .regex(
    /^[a-z0-9-]+$/,
    'Slug must be lowercase letters, numbers, and hyphens only',
  );

// ---------------------------------------------------------------------------
// Tile types & templates (mirrors type unions for runtime validation)
// ---------------------------------------------------------------------------

const tileTypeSchema = z.enum([
  'link',
  'media',
  'embed_map',
  'embed_menu',
  'embed_social',
  'embed_events',
]);

const templateSchema = z.enum(['classic', 'grid', 'magazine', 'minimal']);

const fontSchema = z.enum(['inter', 'playfair', 'space-grotesk', 'dm-serif']);

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  slug: slugSchema,
  displayName: z.string().max(100).nullish(),
  bio: z.string().max(500).nullish(),
  logoUrl: z.string().max(500).nullish(),
  heroMediaId: z.string().uuid().nullish(),
  theme: z.record(z.string(), z.unknown()).optional(),
  phoneNumber: z.string().max(30).nullish(),
  whatsappNumber: z.string().max(30).nullish(),
  bookingUrl: z.string().url('Must be a valid URL').nullish().or(z.literal('')),
  menuUrl: z.string().url('Must be a valid URL').nullish().or(z.literal('')),
  parkingUrl: z.string().url('Must be a valid URL').nullish().or(z.literal('')),
  directionsUrl: z.string().url('Must be a valid URL').nullish().or(z.literal('')),
  facebookUrl: z.string().url('Must be a valid URL').nullish().or(z.literal('')),
  instagramUrl: z.string().url('Must be a valid URL').nullish().or(z.literal('')),
  websiteUrl: z.string().url('Must be a valid URL').nullish().or(z.literal('')),
  template: templateSchema.optional(),
  fontFamily: fontSchema.optional(),
  isPublished: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

export const tileSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().min(1, 'Title is required').max(100),
    subtitle: z.string().max(200).nullish(),
    ctaLabel: z.string().min(1).max(30).default('Visit'),
    ctaUrl: z.string().max(2048).default(''),
    mediaAssetId: z.string().uuid().nullish(),
    enabled: z.boolean().optional(),
    tileType: tileTypeSchema.optional(),
    embedData: z.record(z.string(), z.unknown()).nullish(),
  })
  .refine(
    (data) => {
      // ctaUrl must be a valid URL when tile type is 'link' and ctaUrl is non-empty
      if ((!data.tileType || data.tileType === 'link') && data.ctaUrl) {
        try {
          new URL(data.ctaUrl);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: 'CTA URL must be a valid URL for link tiles',
      path: ['ctaUrl'],
    },
  );
