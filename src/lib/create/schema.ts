import { z } from "zod";

import { DEFAULT_TIMEZONE } from "@/lib/constants";

export const platformEnum = z.enum(["facebook", "instagram", "gbp"]);
export const placementEnum = z.enum(["feed", "story"]);

const mediaAssetSchema = z.object({
  assetId: z.string(),
  mediaType: z.enum(["image", "video"]),
  fileName: z.string().optional(),
});

const optionalUrlFormField = z
  .union([z.string().trim().url("Enter a valid URL"), z.literal("")])
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

export const advancedOptionsSchema = z.object({
  toneAdjust: toneAdjustEnum.default("default"),
  lengthPreference: lengthPreferenceEnum.default("standard"),
  includeHashtags: z.boolean().default(true),
  includeEmojis: z.boolean().default(true),
  ctaStyle: ctaStyleEnum.default("default"),
});

export const instantPostSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    prompt: z.string().default(""),
    publishMode: z.enum(["now", "schedule"]),
    scheduledFor: z.date().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    media: z.array(mediaAssetSchema).optional(),
    ctaUrl: z.string().url("Enter a valid URL").optional(),
    linkInBioUrl: z.string().url("Enter a valid URL").optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    placement: placementEnum.default("feed"),
  })
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

      const disallowedPlatform = data.platforms.find((platform) => platform === "gbp");
      if (disallowedPlatform) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories are only supported on Facebook and Instagram.",
          path: ["platforms"],
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
    linkInBioUrl: optionalUrlFormField,
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    placement: placementEnum.default("feed"),
  })
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

      const disallowedPlatform = data.platforms.find((platform) => platform === "gbp");
      if (disallowedPlatform) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stories are only supported on Facebook and Instagram.",
          path: ["platforms"],
        });
      }
    }
  });

const storySeriesSlotFormSchema = z
  .object({
    date: z.string().min(1, "Select a date"),
    time: z.string().regex(/^\d{2}:\d{2}$/, "Select a time"),
    media: z
      .array(mediaAssetSchema)
      .min(1, "Attach an image for this story")
      .max(1, "Stories use exactly one image")
      .superRefine((media, ctx) => {
        const first = media[0];
        if (!first) return;
        if (first.mediaType !== "image") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Stories support images only.",
            path: ["media", 0],
          });
        }
      }),
  })
  .superRefine((slot, ctx) => {
    if (!slot.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a date.",
        path: ["date"],
      });
    }
  });

const storySeriesSlotSchema = z
  .object({
    scheduledFor: z.date(),
    media: z
      .array(mediaAssetSchema)
      .min(1, "Attach an image for this story")
      .max(1, "Stories use exactly one image")
      .superRefine((media, ctx) => {
        const first = media[0];
        if (!first) return;
        if (first.mediaType !== "image") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Stories support images only.",
            path: ["media", 0],
          });
        }
      }),
  })
  .superRefine((slot, ctx) => {
    if (!(slot.scheduledFor instanceof Date) || Number.isNaN(slot.scheduledFor.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Scheduled time required.",
        path: ["scheduledFor"],
      });
    }
  });

export const storySeriesFormSchema = z
  .object({
    title: z.string().min(1, "Series name is required"),
    notes: z.string().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    slots: z.array(storySeriesSlotFormSchema).min(1, "Add at least one story slot"),
  })
  .superRefine((data, ctx) => {
    if (data.platforms.some((platform) => platform === "gbp")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stories are only supported on Facebook and Instagram.",
        path: ["platforms"],
      });
    }

    const seen = new Set<string>();
    data.slots.forEach((slot, index) => {
      const key = `${slot.date}|${slot.time}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each story needs a unique date and time.",
          path: ["slots", index],
        });
      } else {
        seen.add(key);
      }
    });
  });

export const storySeriesSchema = z
  .object({
    title: z.string().min(1, "Series name is required"),
    notes: z.string().optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    slots: z.array(storySeriesSlotSchema).min(1, "Add at least one story slot"),
  })
  .superRefine((data, ctx) => {
    if (data.platforms.some((platform) => platform === "gbp")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stories are only supported on Facebook and Instagram.",
        path: ["platforms"],
      });
    }

    const seen = new Set<string>();
    data.slots.forEach((slot, index) => {
      const key = slot.scheduledFor?.toISOString?.();
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Story schedule slots must be unique.",
          path: ["slots", index, "scheduledFor"],
        });
      } else {
        seen.add(key);
      }
    });
  });

const eventBaseSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  description: z.string().min(1, "Give us some detail"),
  startDate: z.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  prompt: z.string().optional(),
  ctaUrl: z.string().url("Enter a valid URL").optional(),
  linkInBioUrl: z.string().url("Enter a valid URL").optional(),
  platforms: z.array(platformEnum).min(1, "Select at least one platform"),
  heroMedia: z.array(mediaAssetSchema).optional(),
  toneAdjust: toneAdjustEnum.default("default"),
  lengthPreference: lengthPreferenceEnum.default("standard"),
  includeHashtags: z.boolean().default(true),
  includeEmojis: z.boolean().default(true),
  ctaStyle: ctaStyleEnum.default("default"),
});

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
  })
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

export const promotionCampaignSchema = z
  .object({
    name: z.string().min(1, "Promotion name is required"),
    offerSummary: z.string().min(1, "Tell guests what the offer is"),
    startDate: z.date(),
    endDate: z.date(),
    prompt: z.string().optional(),
    ctaUrl: z.string().url("Enter a valid URL").optional(),
    linkInBioUrl: z.string().url("Enter a valid URL").optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    heroMedia: z.array(mediaAssetSchema).optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    customSchedule: z.array(z.date()).optional(),
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

export const promotionCampaignFormSchema = z
  .object({
    name: z.string().min(1, "Promotion name is required"),
    offerSummary: z.string().min(1, "Tell guests what the offer is"),
    startDate: z.string().min(1, "Start date required"),
    endDate: z.string().min(1, "End date required"),
    prompt: z.string().optional(),
    ctaUrl: optionalUrlFormField,
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
  })
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

export const weeklyCampaignSchema = z
  .object({
    name: z.string().min(1, "Campaign name is required"),
    description: z.string().min(1, "Give us some detail"),
    dayOfWeek: z.number().int().min(0).max(6),
    startDate: z.date(),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    weeksAhead: z.number().int().min(1).max(12).default(4),
    prompt: z.string().optional(),
    ctaUrl: z.string().url("Enter a valid URL").optional(),
    linkInBioUrl: z.string().url("Enter a valid URL").optional(),
    platforms: z.array(platformEnum).min(1, "Select at least one platform"),
    heroMedia: z.array(mediaAssetSchema).optional(),
    toneAdjust: toneAdjustEnum.default("default"),
    lengthPreference: lengthPreferenceEnum.default("standard"),
    includeHashtags: z.boolean().default(true),
    includeEmojis: z.boolean().default(true),
    ctaStyle: ctaStyleEnum.default("default"),
    customSchedule: z.array(z.date()).optional(),
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

export const weeklyCampaignFormSchema = z
  .object({
    name: z.string().min(1, "Campaign name is required"),
    description: z.string().min(1, "Give us some detail"),
    dayOfWeek: z.string().min(1, "Select a day"),
    startDate: z.string().min(1, "Start date required"),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    weeksAhead: z.string().optional(),
    prompt: z.string().optional(),
    ctaUrl: optionalUrlFormField,
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
  })
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
export type StorySeriesInput = z.infer<typeof storySeriesSchema>;
export type StorySeriesFormValues = z.infer<typeof storySeriesFormSchema>;
export type EventCampaignInput = z.infer<typeof eventCampaignSchema>;
export type EventCampaignFormValues = z.infer<typeof eventCampaignFormSchema>;
export type PromotionCampaignInput = z.infer<typeof promotionCampaignSchema>;
export type PromotionCampaignFormValues = z.infer<typeof promotionCampaignFormSchema>;
export type WeeklyCampaignInput = z.infer<typeof weeklyCampaignSchema>;
export type WeeklyCampaignFormValues = z.infer<typeof weeklyCampaignFormSchema>;

export type InstantPostAdvancedOptions = z.infer<typeof advancedOptionsSchema>;
