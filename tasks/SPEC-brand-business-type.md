# SPEC: Brand-aware AI copy (business type and description)

Status: approved by the owner in chat on 22 September 2026 ("make the AI write for each brand's own
type of business instead of always as a pub", using orangejelly.co.uk for Orange Jelly's details).
Complexity 4 (7+ files, one additive schema change), so two stacked PRs.

## What changes

Each brand gets two optional Brand Voice settings:

- **Business type**: a short phrase such as "pub" or "websites and applications company".
- **About the business**: one or two factual sentences the AI can use as background.

When a brand's business type is blank, every prompt stays byte-for-byte what it is today (the pub
house style, pub examples and pub photo-tagging wording). When it is set, the post-copy prompt and
the photo-tagging prompt describe that business instead and leave out the pub-only rules and
examples.

## Why

CheersAI now hosts more than one brand (Orange Jelly is next), but the live prompts hardcode a
British pub: "expert hospitality social media copywriter", "the way a landlord would", Sunday roast
and pint examples, and photo tagging "for a UK hospitality venue (pub, bar, or restaurant)". A
non-pub brand's posts and library tags would read like a pub.

## Design

**Storage.** Two nullable columns on `public.brand_profile` (one row per brand, the table the Brand
Voice form already writes): `business_type text` (at most 60 characters) and
`business_description text` (at most 400 characters), each with a length check. Null means "not
set". No backfill: The Anchor keeps its current behaviour by leaving the type blank.

**Blank means pub.** Chosen over backfilling The Anchor with "pub" plus a neutral default, because
it guarantees The Anchor's prompts do not change at all and needs no data migration. A new pub brand
also gets the right behaviour without filling anything in. The Settings help text says so.

**Settings (PR 1).** New "Your business" fields at the top of Settings, Brand Voice. Zod trims both,
turns empty into null, and enforces the same limits as the database. `updateBrandProfile` writes
them; `getOwnerSettings` and the `BrandProfile` type carry them.

**Prompts (PR 2).**

- `buildSystemPrompt` (v2 create wizard, the live copy path): with a business type, the opening line
  names the business type, adds the description, uses a writing-rules list with the pub-only lines
  made neutral, and replaces the pub few-shot examples with the grammar and point-of-view rules
  alone. Without one, output is identical to today.
- `generateMediaNameAndTags` (library auto-naming): takes an optional business type; with one, the
  system prompt describes that business's media library instead of a pub's.
- `loadBrandProfile` in `src/app/actions/ai-generate.ts` and `autoNameAndTagMediaAsset` in
  `src/app/(app)/library/actions.ts` load the new fields for the active brand, scoped by
  `account_id`.

**Out of scope (parked).** Paid Meta ads generation (`src/lib/campaigns/generate.ts`) stays
hospitality-only; the dead v1 instant-post prompt is untouched; the create wizard's event venue
default ("The Anchor, Stanwell Moor Village") is a visible, editable form default and is unchanged.

## Deploy order and rollback

1. Apply migration `20260922120000_brand_profile_business_type.sql` to production first. PR 1 and
   PR 2 select the new columns; if code ships first, the Settings page and copy generation fall
   back to default brand voice, silently dropping The Anchor's tone and phrases.
2. Merge PR 1 (Settings fields). Harmless on its own: values are stored but unused.
3. Merge PR 2 (prompts).

Rollback: revert PR 2 (prompts return to pub-only), then PR 1. The columns can stay; dropping them
(`alter table public.brand_profile drop column business_type, drop column business_description;`)
needs the owner's approval because it discards entered text.

## Tests

- Prompt builder: a blank type keeps the pub wording (unit test), and is proved byte-identical to
  `main` by diffing both builds' output for every content type (one-off check, recorded in the PR);
  a set type includes the type and description and contains none of the pub-only wording
  ("hospitality", "landlord", "Sunday roast", "pint", "The Anchor").
- Media tagging: system prompt with and without a business type.
- Settings: schema trims and nulls empty values and rejects over-length text; the save action writes
  both columns; the loader maps them.
- Both time zones (`npm run test:ci` under Europe/London and UTC), lint, typecheck and build.

## Decisions

- Orange Jelly's values, from the live site (orangejelly.co.uk home and /about, 22 September 2026):
  type "websites and applications company"; description "Orange Jelly is a small company that builds
  websites, bespoke applications and connected systems for small and mid-sized businesses, using AI
  where it adds value. Everything is tested first at The Anchor, our own venue in Stanwell Moor."
