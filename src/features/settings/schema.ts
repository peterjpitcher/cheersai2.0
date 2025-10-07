import { z } from "zod";

export const brandProfileFormSchema = z.object({
  toneFormal: z.number().min(0).max(1),
  tonePlayful: z.number().min(0).max(1),
  keyPhrases: z.array(z.string()).max(10),
  bannedTopics: z.array(z.string()).max(10),
  defaultHashtags: z.array(z.string()).max(15),
  defaultEmojis: z.array(z.string()).max(10),
  instagramSignature: z.string().optional(),
  facebookSignature: z.string().optional(),
  gbpCta: z.string().optional(),
});

export type BrandProfileFormValues = z.infer<typeof brandProfileFormSchema>;

export const postingDefaultsFormSchema = z.object({
  timezone: z.string(),
  facebookLocationId: z.string().optional(),
  instagramLocationId: z.string().optional(),
  gbpLocationId: z.string().optional(),
  notifications: z.object({
    emailFailures: z.boolean(),
    emailTokenExpiring: z.boolean(),
  }),
  gbpCtaDefaults: z.object({
    standard: z.enum(["LEARN_MORE", "BOOK", "CALL"]),
    event: z.enum(["LEARN_MORE", "BOOK", "CALL"]),
    offer: z.enum(["REDEEM", "CALL", "LEARN_MORE"]),
  }),
});

export type PostingDefaultsFormValues = z.infer<typeof postingDefaultsFormSchema>;

const slugPattern = /^[a-z0-9-]+$/;

const optionalUrlField = z
  .union([z.literal(""), z.string().trim().url("Enter a valid URL")])
  .transform((value) => (value ? value : undefined))
  .optional();

const optionalPhoneField = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^[0-9+()\-\s]+$/, "Use digits, spaces, parentheses, + or -"),
  ])
  .transform((value) => (value ? value : undefined))
  .optional();

const optionalColourField = z
  .union([
    z.literal(""),
    z.string().trim().regex(/^#([0-9a-fA-F]{6})$/, "Enter a HEX colour e.g. #005131"),
  ])
  .transform((value) => (value ? value.toLowerCase() : undefined))
  .optional();

export const linkInBioProfileFormSchema = z.object({
  slug: z
    .string()
    .min(3, "Enter at least 3 characters")
    .max(64, "Keep the slug under 64 characters")
    .regex(slugPattern, "Use lowercase letters, numbers, and hyphens"),
  displayName: z.union([z.string().trim().max(120), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  bio: z.union([z.string().trim().max(280), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  heroMediaId: z.union([z.string(), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  theme: z
    .object({
      primaryColor: optionalColourField,
      secondaryColor: optionalColourField,
    })
    .default({}),
  phoneNumber: optionalPhoneField,
  whatsappNumber: optionalPhoneField,
  bookingUrl: optionalUrlField,
  menuUrl: optionalUrlField,
  parkingUrl: optionalUrlField,
  directionsUrl: optionalUrlField,
  facebookUrl: optionalUrlField,
  instagramUrl: optionalUrlField,
  websiteUrl: optionalUrlField,
});

export type LinkInBioProfileFormValues = z.infer<typeof linkInBioProfileFormSchema>;

export const linkInBioTileFormSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Add a title").max(80, "Keep titles under 80 characters"),
  subtitle: z
    .union([z.string().trim().max(140), z.literal("")])
    .transform((value) => (value ? value : undefined))
    .optional(),
  ctaLabel: z.string().trim().min(1, "Add a CTA label").max(30, "Keep CTA labels concise"),
  ctaUrl: z.string().trim().url("Enter a valid URL"),
  mediaAssetId: z.union([z.string(), z.literal("")]).transform((value) => (value ? value : undefined)).optional(),
  enabled: z.boolean().default(true),
});

export type LinkInBioTileFormValues = z.infer<typeof linkInBioTileFormSchema>;

export const linkInBioTileReorderSchema = z.object({
  tileIds: z.array(z.string().uuid()),
});

export type LinkInBioTileReorderValues = z.infer<typeof linkInBioTileReorderSchema>;
