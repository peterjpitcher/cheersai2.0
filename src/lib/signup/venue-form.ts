import { z } from 'zod';

/**
 * The /signup/venue form (tasks/SPEC-self-serve-signup.md §4.4): its fields,
 * limits and checks. Pure, so the page, the form and the server action share
 * one definition; the server action is the only place that trusts it.
 */

export const VENUE_NAME_MAX = 120;
export const FULL_NAME_MAX = 80;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;

/**
 * The venue types offered, and what each stores in brand_profile.business_type
 * (which the AI prompts read and which ticks the setup checklist's profile
 * step). "Other" stores "hospitality venue": the prompts write "Business type:
 * <value>" and tell the model not to write as a hospitality venue unless the
 * type says it is one, so a literal "other" would steer every post away from
 * hospitality. public.provision_self_serve_brand accepts exactly these values.
 */
export const VENUE_TYPES = [
  { value: 'pub', label: 'Pub', stored: 'pub' },
  { value: 'bar', label: 'Bar', stored: 'bar' },
  { value: 'restaurant', label: 'Restaurant', stored: 'restaurant' },
  { value: 'cafe', label: 'Cafe', stored: 'cafe' },
  { value: 'hotel', label: 'Hotel', stored: 'hotel' },
  { value: 'other', label: 'Other hospitality venue', stored: 'hospitality venue' },
] as const;

export type VenueType = (typeof VENUE_TYPES)[number]['value'];

const VENUE_TYPE_VALUES = VENUE_TYPES.map((type) => type.value) as [VenueType, ...VenueType[]];

/** What brand_profile.business_type gets for a venue type. */
export function storedBusinessType(type: VenueType): string {
  const match = VENUE_TYPES.find((entry) => entry.value === type);
  if (!match) throw new Error(`Unknown venue type: ${type}`);
  return match.stored;
}

/**
 * A venue name goes into our emails (the operator's new-venue email and, later,
 * team invites), so it may not carry a link or an email address (spec §4.4).
 */
export function venueNameHasLink(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('://') || lower.includes('www.') || lower.includes('@');
}

/** Line breaks, tabs and other control characters: never wanted in a name. */
export function hasControlCharacters(text: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(text);
}

export const VENUE_FORM_MESSAGES = {
  email: 'Enter the email address you signed up with.',
  fullName: 'Enter your name.',
  fullNameTooLong: `Use ${FULL_NAME_MAX} characters or fewer for your name.`,
  fullNameInvalid: 'Your name can only contain letters, numbers, spaces and punctuation.',
  passwordShort: `Use at least ${PASSWORD_MIN} characters for your password.`,
  passwordLong: `Use ${PASSWORD_MAX} characters or fewer for your password.`,
  passwordMismatch: 'The passwords do not match.',
  venueName: "Enter your venue's name.",
  venueNameTooLong: `Use ${VENUE_NAME_MAX} characters or fewer for your venue's name.`,
  venueNameLink: "Your venue's name cannot contain a web address or an email address.",
  venueNameInvalid: "Your venue's name can only contain letters, numbers, spaces and punctuation.",
  venueType: 'Choose the kind of venue.',
  business: 'Tick the box to confirm you are signing up for a business.',
} as const;

export const venueFormSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254, VENUE_FORM_MESSAGES.email).email(VENUE_FORM_MESSAGES.email),
    fullName: z
      .string()
      .trim()
      .min(1, VENUE_FORM_MESSAGES.fullName)
      .max(FULL_NAME_MAX, VENUE_FORM_MESSAGES.fullNameTooLong)
      .refine((name) => !hasControlCharacters(name), VENUE_FORM_MESSAGES.fullNameInvalid),
    password: z
      .string()
      .min(PASSWORD_MIN, VENUE_FORM_MESSAGES.passwordShort)
      .max(PASSWORD_MAX, VENUE_FORM_MESSAGES.passwordLong),
    confirm: z.string(),
    venueName: z
      .string()
      .trim()
      .min(1, VENUE_FORM_MESSAGES.venueName)
      .max(VENUE_NAME_MAX, VENUE_FORM_MESSAGES.venueNameTooLong)
      .refine((name) => !venueNameHasLink(name), VENUE_FORM_MESSAGES.venueNameLink)
      .refine((name) => !hasControlCharacters(name), VENUE_FORM_MESSAGES.venueNameInvalid),
    venueType: z.enum(VENUE_TYPE_VALUES, { message: VENUE_FORM_MESSAGES.venueType }),
    // A checkbox sends "on" when ticked and nothing when not.
    business: z.literal('on', { message: VENUE_FORM_MESSAGES.business }),
  })
  .refine((value) => value.password === value.confirm, {
    message: VENUE_FORM_MESSAGES.passwordMismatch,
    path: ['confirm'],
  });

export type VenueForm = z.infer<typeof venueFormSchema>;

/** Reads the form's fields as strings (a missing field becomes undefined, which the schema refuses). */
export function readVenueForm(formData: FormData): Record<keyof VenueForm, string | undefined> {
  const field = (name: string): string | undefined => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  return {
    email: field('email'),
    fullName: field('fullName'),
    password: field('password'),
    confirm: field('confirm'),
    venueName: field('venueName'),
    venueType: field('venueType'),
    business: field('business'),
  };
}
