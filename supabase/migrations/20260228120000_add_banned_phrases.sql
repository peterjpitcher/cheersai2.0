alter table brand_profile
  add column if not exists banned_phrases text[] not null default '{}';
