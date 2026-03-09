-- Drop incorrect policies that used auth.uid() instead of public.current_account_id()
drop policy if exists "Users can read own reviews" on gbp_reviews;
drop policy if exists "Users can update own reviews" on gbp_reviews;

-- Recreate policies using the project-standard auth helper
create policy "Users can read own reviews"
  on gbp_reviews for select
  using (auth.role() = 'service_role' or business_profile_id = public.current_account_id());

create policy "Users can update own reviews"
  on gbp_reviews for update
  using (auth.role() = 'service_role' or business_profile_id = public.current_account_id())
  with check (auth.role() = 'service_role' or business_profile_id = public.current_account_id());

-- Add performance index for the primary UI list query (account + recency)
create index if not exists gbp_reviews_account_create_time_idx
  on gbp_reviews (business_profile_id, create_time desc);
