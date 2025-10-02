-- Add encrypted token columns for social connections if missing
alter table public.social_connections
  add column if not exists access_token_encrypted text,
  add column if not exists refresh_token_encrypted text;
