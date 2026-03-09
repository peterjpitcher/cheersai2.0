create table if not exists gbp_reviews (
  id                uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references accounts(id) on delete cascade,
  google_review_id  text not null,
  reviewer_name     text not null default '',
  star_rating       integer not null check (star_rating between 1 and 5),
  comment           text,
  create_time       timestamptz not null,
  update_time       timestamptz not null,
  reply_comment     text,
  reply_update_time timestamptz,
  ai_draft          text,
  status            text not null default 'pending' check (status in ('pending', 'draft_ready', 'replied')),
  synced_at         timestamptz not null default now(),
  constraint gbp_reviews_business_review_unique unique (business_profile_id, google_review_id)
);

alter table gbp_reviews enable row level security;

create policy "Users can read own reviews"
  on gbp_reviews for select
  using (auth.role() = 'service_role' or business_profile_id = public.current_account_id());

create policy "Users can update own reviews"
  on gbp_reviews for update
  using (auth.role() = 'service_role' or business_profile_id = public.current_account_id())
  with check (auth.role() = 'service_role' or business_profile_id = public.current_account_id());

create index if not exists gbp_reviews_account_create_time_idx
  on gbp_reviews (business_profile_id, create_time desc);
