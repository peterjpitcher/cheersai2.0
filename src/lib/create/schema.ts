import { z } from "zod";

import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { BannerDefaultsSchema } from "@/lib/scheduling/banner-config";

export const platformEnum = z.enum(["facebook", "instagram"]);
export const placementEnum = z.enum(["feed", "story"]);
const eventPlacementsSchema = z
  .array(placementEnum)
  .length(1, "Choose either a post or a story for event campaigns, not both")
  .default(["feed"]);
const campaignPlacementsSchema = z
  .array(placementEnum)
  .min(1, "Select at least one placement")
  .default(["feed"]);

const mediaAssetSchema = z.object({
  assetId: z.string(),
  mediaType: z.enum(["image", "video"]),
  fileName: z.string().optional(),
});

const optionalUrlFormField = z
  .union([z.string().trim().url("Enter a valid URL"), z.literal("")])
  .transform((value) => (value ? value : undefined))
  .optional();

const optionalCtaLabelFormField = z
  .union([z.literal(""), z.string().trim().min(1, "Select a link goal").max(30, "Keep link goals concise")])
  .transform((value) => (value ? value : undefined))
  .optional();


export const toneAdjustEnum = z.enum([
  "default",
  "more_formal",
  "more_casual",
  "more_serious",
  "more_playful",
]);

export const lengthPreferenceEnum = z.enum(["standard", "short", "detailed"]);

export const ctaStyleEnum = z.enum(["default", "direct", "urgent"]);

export const proofPointModeEnum = z.enum(["off", "auto", "selected"]);

const proofPointOptionsSchema = z.object({
  proofPointMode: proofPointModeEnum.default("off"),
  proofPointsSelected: z.array(z.string().trim().min(1)).default([]),
  proofPointIntentTags: z.array(z.string().trim().min(1)).default([]),
});

export const advancedOptionsSchema = z.object({
  toneAdjust: toneAdjustEnum.default("default"),
  lengthPreference: lengthPreferenceEnum.default("standard"),
  includeHashtags: z.boolean().default(true),
  includeEmojis: z.boolean().default(true),
  ctaStyle: ctaStyleEnum.default("default"),
});

/**
 * Optional per-post banner override for the instant-post path.
 *
 * `enabled` is the user's explicit on/off choice; when `enabled` is true the
 * caller may also supply `defaults` (position + colours) from the
 * BannerDefaultsPicker. The form defaults this to `{ enabled: false }` so the
 * service layer can persist `banner_enabled = false` rather than NULL —
 * fixing the silent-default banner bug for instant posts.
 */
export const bannerInputSchema = z
  .object({
    enabled: z.boolean(),
    defaults: BannerDefaultsSchema.optional(),
  })
  .optional();

export const instantPostSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    prompt: z.string().default(""),
    publishMode: z.enum(["now", "schedule"]),
    scheduledFor: z.date().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    media: z.array(mediaAssetSchema).optional(),
    ctaUrl: z.string().url("Enter a valid URL").optional(),
    ctaLabel: z.string().trim().min(1, "Select a link goal").max(30, "Keep link goals concise").optional(),
    linkInBioUrl: z.string().url("Enter a valid URL").optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    placement: placementEnum.default("feed"),
    banner: bannerInputSchema,
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (data.publishMode === "schedule" && (!data.media || data.media.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Scheduled posts require at least one media asset.",
        path: ["media"],
      });
    }

    if (data.placement === "feed" && !data.prompt.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide prompt information for feed posts.",
        path: ["prompt"],
      });
    }

    if (data.placement === "story") {
      if (!data.media || data.media.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories require exactly one media asset.",
          path: ["media"],
        });
      } else if (data.media[0]?.mediaType !== "image") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories support images only.",
          path: ["media"],
        });
      }
    }
  });

export const instantPostFormSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    prompt: z.string().default(""),
    publishMode: z.enum(["now", "schedule"]),
    scheduledFor: z.string().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    media: z.array(mediaAssetSchema).optional(),
    ctaUrl: optionalUrlFormField,
    ctaLabel: optionalCtaLabelFormField,
    linkInBioUrl: optionalUrlFormField,
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    placement: placementEnum.default("feed"),
    banner: bannerInputSchema,
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (data.publishMode === "schedule" && (!data.media || data.media.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add media before scheduling.",
        path: ["media"],
      });
    }

    if (data.placement === "feed" && !data.prompt.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tell us what to post.",
        path: ["prompt"],
      });
    }

    if (data.placement === "story") {
      if (!data.media || data.media.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories require exactly one media asset.",
          path: ["media"],
        });
      } else if (data.media[0]?.mediaType !== "image") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories support images only.",
          path: ["media"],
        });
      }
    }
  });

const eventBaseSchema = z
  .object({
    name: z.string().min(1, "Event name is required"),
    description: z.string().min(1, "Give us some detail"),
    startDate: z.date(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    prompt: z.string().optional(),
    ctaUrl: z.string().url("Enter a valid URL").optional(),
    ctaLabel: z.string().trim().min(1, "Select a link goal").max(30, "Keep link goals concise").optional(),
    linkInBioUrl: z.string().url("Enter a valid URL").optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    heroMedia: z.array(mediaAssetSchema).optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
  })
  .merge(proofPointOptionsSchema);

export const eventCampaignSchema = eventBaseSchema
  .extend({
    scheduleOffsets: z
      .array(
        z.object({
          label: z.string(),
          offsetHours: z.number(),
        }),
      )
      .min(1),
    customSchedule: z.array(z.date()).optional(),
    placements: eventPlacementsSchema,
    bannerDefaults: BannerDefaultsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.heroMedia || data.heroMedia.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attach at least one image or video.",
        path: ["heroMedia"],
      });
    }

    if (data.customSchedule && data.customSchedule.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one manual schedule slot or disable manual scheduling.",
        path: ["customSchedule"],
      });
    }
  });

export const eventCampaignFormSchema = z
  .object({
    name: z.string().min(1, "Event name is required"),
    description: z.string().min(1, "Give us some detail"),
    startDate: z.string().min(1, "Start date required"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().min(1, "Timezone required").default(DEFAULT_TIMEZONE),
    prompt: z.string().optional(),
    ctaUrl: optionalUrlFormField,
    ctaLabel: optionalCtaLabelFormField,
    linkInBioUrl: optionalUrlFormField,
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    heroMedia: z.array(mediaAssetSchema).optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    useManualSchedule: z.boolean().default(false),
    manualSlots: z
      .array(
        z.object({
          date: z.string().min(1, "Date required"),
          time: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      )
      .default([]),
    placements: eventPlacementsSchema,
    bannerDefaults: BannerDefaultsSchema.optional(),
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (!data.heroMedia || data.heroMedia.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attach at least one image or video.",
        path: ["heroMedia"],
      });
    }

    if (data.useManualSchedule && data.manualSlots.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one schedule slot.",
        path: ["manualSlots"],
      });
    }
  });

export const promotionCampaignFormSchema = z
  .object({
    name: z.string().min(1, "Promotion name is required"),
    offerSummary: z.string().min(1, "Tell guests what the offer is"),
    endDate: z.string().min(1, "Promotion end date required"),
    prompt: z.string().optional(),
    ctaUrl: optionalUrlFormField,
    ctaLabel: optionalCtaLabelFormField,
    linkInBioUrl: optionalUrlFormField,
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    heroMedia: z.array(mediaAssetSchema).optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    useManualSchedule: z.boolean().default(false),
    manualSlots: z
      .array(
        z.object({
          date: z.string().min(1, "Date required"),
        }),
      )
      .default([]),
    placements: campaignPlacementsSchema,
    bannerDefaults: BannerDefaultsSchema.optional(),
  })
  .merge(proofPointOptionsSchema)
  .superRefine((data, ctx) => {
    if (!data.heroMedia || data.heroMedia.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attach at least one image or video.",
        path: ["heroMedia"],
      });
    }

    if (data.useManualSchedule && data.manualSlots.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one schedule slot.",
        path: ["manualSlots"],
      });
    }
  });

export type MediaAssetInput = z.infer<typeof mediaAssetSchema>;
export type InstantPostInput = z.infer<typeof instantPostSchema>;
export type InstantPostFormValues = z.infer<typeof instantPostFormSchema>;
export type EventCampaignInput = z.infer<typeof eventCampaignSchema>;
export type EventCampaignFormValues = z.infer<typeof eventCampaignFormSchema>;
export type PromotionCampaignFormValues = z.infer<typeof promotionCampaignFormSchema>;

export type InstantPostAdvancedOptions = z.infer<typeof advancedOptionsSchema>;
