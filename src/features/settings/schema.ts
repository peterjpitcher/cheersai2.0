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
