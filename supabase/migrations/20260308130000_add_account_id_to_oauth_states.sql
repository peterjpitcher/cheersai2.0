-- Migration: add account_id to oauth_states
-- Required for the Meta Ads OAuth flow where token exchange happens server-side
-- in the callback and needs to know the account to store credentials for.

ALTER TABLE public.oauth_states
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES auth.users ON DELETE CASCADE;
