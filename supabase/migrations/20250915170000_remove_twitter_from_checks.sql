-- Remove Twitter from platform-related CHECK constraints
-- Note: Adjust names if they differ in your environment.

begin;

-- Normalise any existing 'twitter' rows so new CHECKs won't fail
-- If any twitter rows are marked default, unset to avoid unique conflicts on (platform, content_type) WHERE is_default
update public.ai_platform_prompts
  set is_default = false
  where platform = 'twitter' and is_default = true;

update public.ai_platform_prompts
  set platform = 'general'
  where platform = 'twitter';

update public.social_connections
  set platform = 'instagram'
  where platform = 'twitter';

-- Also normalise any other non-allowed platforms for these tables
update public.social_connections
  set platform = 'instagram'
  where platform not in ('facebook','instagram','google_my_business');

update public.campaign_posts
  set platform = 'instagram'
  where platform = 'twitter';

update public.campaign_posts
  set platform = 'instagram'
  where platform not in ('facebook','instagram','google_my_business');

-- ai_platform_prompts.platform check: drop and recreate without 'twitter'
alter table if exists public.ai_platform_prompts
  drop constraint if exists ai_platform_prompts_platform_check;

alter table if exists public.ai_platform_prompts
  add constraint ai_platform_prompts_platform_check
  check (platform = any (array['facebook','instagram','linkedin','google_my_business','general']));

-- Optional: if you have other tables with a platform CHECK, update similarly
-- Example: social_connections.platform
alter table if exists public.social_connections
  drop constraint if exists social_connections_platform_check;

alter table if exists public.social_connections
  add constraint social_connections_platform_check
  check (platform = any (array['facebook','instagram','google_my_business']));

-- Example: campaign_posts.platform (if present)
alter table if exists public.campaign_posts
  drop constraint if exists campaign_posts_platform_check;

alter table if exists public.campaign_posts
  add constraint campaign_posts_platform_check
  check (platform = any (array['facebook','instagram','google_my_business']));

commit;
