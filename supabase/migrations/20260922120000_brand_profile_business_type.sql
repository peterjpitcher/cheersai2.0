-- What kind of business a brand is, so AI copy stops assuming every brand is a pub.
--
-- CheersAI now hosts more than one brand, but the copy and photo-tagging prompts hardcode a
-- British pub. Two optional Brand Voice settings let each brand say what it is:
--   business_type        a short phrase, e.g. "websites and applications company" (max 60)
--   business_description one or two factual sentences of background for the AI (max 400)
--
-- Null means "not set", and the app then keeps today's pub prompts exactly, so The Anchor
-- (the only brand_profile row on the live project, 22 September 2026) changes behaviour
-- only if someone fills the fields in. The app trims both values and stores empty as null;
-- the checks only cap the length, matching the Settings form.
--
-- Additive and non-destructive: nullable with no default, so Postgres does not rewrite the
-- table, and every existing row starts null, so neither check can fail. No view, trigger or
-- function references brand_profile (checked on the live project, 22 September 2026). RLS is
-- unchanged: the table's existing policy covers the new columns, and no grants change.
--
-- Deploy order: apply this before the app change that reads and writes the columns
-- (tasks/SPEC-brand-business-type.md). That code selects both columns when it loads brand
-- voice, and falls back to default brand voice if they are missing.
--
-- Rollback (only once no code reads the columns, and only with the owner's approval,
-- because it discards entered text):
--   alter table public.brand_profile
--     drop column if exists business_type,
--     drop column if exists business_description;

alter table public.brand_profile
  add column if not exists business_type text
  constraint brand_profile_business_type_length_check
  check (business_type is null or char_length(business_type) <= 60);

alter table public.brand_profile
  add column if not exists business_description text
  constraint brand_profile_business_description_length_check
  check (business_description is null or char_length(business_description) <= 400);

comment on column public.brand_profile.business_type is
  'Short phrase for what the brand is, e.g. "websites and applications company". Null means not set: AI copy keeps the default pub house style.';

comment on column public.brand_profile.business_description is
  'One or two factual sentences about the business, given to the AI as background. Null means not set.';
