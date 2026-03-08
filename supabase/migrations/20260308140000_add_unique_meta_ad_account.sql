-- Add unique constraint on meta_ad_accounts.account_id
-- Required for upsert (ON CONFLICT account_id) in the Meta Ads OAuth callback.
ALTER TABLE public.meta_ad_accounts
  ADD CONSTRAINT meta_ad_accounts_account_id_key UNIQUE (account_id);
