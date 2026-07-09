/**
 * Zod validation schemas for all 5 content types.
 *
 * Each content type extends a base schema with shared fields (title, platforms,
 * fine-tune controls). The discriminated union `contentBriefSchema` parses any
 * content type based on the `contentType` field.
 *
 * Tone enum values use snake_case IDs matching D-05 curated hospitality tones.
 */

import { z } from 'zod';

const placementSchema = z.enum(['feed', 'story']);
const eventPlacementsSchema = z
  .array(placementSchema)
  .length(1, 'Choose either a post or a story for event campaigns, not both.')
  .default(['feed']);
const campaignPlacementsSchema = z
  .array(placementSchema)
  .min(1, 'Select at least one placement')
  .default(['feed']);

// ---------------------------------------------------------------------------
// Base schema: fields shared by all content types
// ---------------------------------------------------------------------------

const baseContentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  prompt: z.string().default(''),
  platforms: z
    .array(z.enum(['facebook', 'instagram']))
    .min(1, 'Select at least one platform'),
  // Fine-tune controls (D-04 progressive disclosure defaults)
  tone: z
    .enum([
      'friendly_warm',
      'professional',
      'playful',
      'sophisticated',
      'community_focused',
    ])
    .default('friendly_warm'),
  lengthPreference: z
    .enum(['standard', 'short', 'detailed'])
    .default('standard'),
  includeHashtags: z.boolean().default(true),
  includeEmojis: z.boolean().default(true),
  ctaStyle: z
    .enum(['default', 'direct', 'urgent', 'none'])
    .default('default'),
  proofPoints: z.array(z.string()).default([]),
  ctaLinks: z
    .object({
      facebook: z.string().url().optional(),
      instagram: z.string().url().optional(),
    })
    .partial()
    .optional(),
});

// ---------------------------------------------------------------------------
// Content-type-specific schemas
// ---------------------------------------------------------------------------

export const instantPostBriefSchema = baseContentSchema.extend({
  contentType: z.literal('instant_post'),
  publishMode: z.enum(['now', 'schedule']),
  scheduledFor: z.string().datetime().optional(),
});

export const storyBriefSchema = baseContentSchema.extend({
  contentType: z.literal('story'),
  platforms: z
    .array(z.enum(['facebook', 'instagram']))
    .min(1, 'Stories are Facebook/Instagram only'),
});

export const eventBriefSchema = baseContentSchema.extend({
  contentType: z.literal('event'),
  eventName: z.string().min(1, 'Event name is required').max(200),
  eventDate: z.string().date(),
  eventTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'),
  eventEndDate: z
    .union([z.string().date(), z.literal('')])
    .transform((v) => v || undefined)
    .optional(),
  venue: z.string().max(200).optional(),
  placements: eventPlacementsSchema,
});

export const promotionBriefSchema = baseContentSchema.extend({
  contentType: z.literal('promotion'),
  offerSummary: z.string().min(1, 'Describe the offer').max(500),
  couponCode: z.string().max(50).optional(),
  startDate: z
    .union([z.string().date(), z.literal('')])
    .transform((v) => v || undefined)
    .optional(),
  endDate: z.string().date(),
  placements: campaignPlacementsSchema,
});

export const weeklyCampaignBriefSchema = baseContentSchema.extend({
  contentType: z.literal('weekly_recurring'),
  // Days to post on each week, JS getDay() convention (0=Sunday..6=Saturday).
  // Multi-select; at least one, at most seven, no duplicates.
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Pick at least one day')
    .max(7, 'Pick at most seven days')
    .refine((days) => new Set(days).size === days.length, 'Days must be unique'),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'),
  // Calendar end date (YYYY-MM-DD, Europe/London). Occurrences are generated up
  // to and including this date. The occurrence-count bound (1-12) is enforced in
  // the wizard and server-side in createScheduledBatch, not here, because the
  // count depends on the current date and must stay out of the pure schema.
  endDate: z.string().date(),
  // Whether each occurrence posts to the feed or as a story (Facebook/Instagram only).
  placement: z.enum(['feed', 'story']).default('feed'),
});

// ---------------------------------------------------------------------------
// Discriminated union: parse any content brief by contentType
// ---------------------------------------------------------------------------

export const contentBriefSchema = z.discriminatedUnion('contentType', [
  instantPostBriefSchema,
  storyBriefSchema,
  eventBriefSchema,
  promotionBriefSchema,
  weeklyCampaignBriefSchema,
]);

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type ContentBrief = z.infer<typeof contentBriefSchema>;
export type ContentBriefInput = z.input<typeof contentBriefSchema>;
export type InstantPostBrief = z.infer<typeof instantPostBriefSchema>;
export type StoryBrief = z.infer<typeof storyBriefSchema>;
export type EventBrief = z.infer<typeof eventBriefSchema>;
export type PromotionBrief = z.infer<typeof promotionBriefSchema>;
export type WeeklyCampaignBrief = z.infer<typeof weeklyCampaignBriefSchema>;
