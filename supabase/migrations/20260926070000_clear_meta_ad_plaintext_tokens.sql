-- Clear the plaintext Meta ads tokens (tasks/SPEC-encrypt-meta-ad-tokens.md, phase 2).
--
-- Phase 1 (PR #102) moved every reader and writer to the encrypted
-- meta_ad_account_tokens table and copied existing tokens into it on first read.
-- This blanks the legacy plaintext columns on meta_ad_accounts, then adds CHECK
-- constraints so no code path can ever write a plaintext token there again.
-- It aborts, changing nothing, if any brand still has a plaintext token with no
-- encrypted copy.
--
-- Apply only after the spec's pre-check shows every plaintext token has an
-- encrypted copy that production has read successfully. Phase 1 code is
-- compatible with the cleared columns (it reads the vault first and only ever
-- writes '' or null to them), so this can apply before the phase 2 code deploys.
--
-- Rollback: drop the two constraints. The cleared plaintext cannot be restored
-- from the database; the encrypted copies are the source of truth.
--   alter table public.meta_ad_accounts drop constraint if exists meta_ad_accounts_access_token_not_plaintext;
--   alter table public.meta_ad_accounts drop constraint if exists meta_ad_accounts_capi_token_not_plaintext;

do $$
declare
  unmigrated integer;
begin
  select count(*) into unmigrated
  from public.meta_ad_accounts m
  where (
      coalesce(m.access_token, '') <> ''
      and not exists (
        select 1 from public.meta_ad_account_tokens t
        where t.account_id = m.account_id and t.token_type = 'access'
      )
    )
    or (
      coalesce(m.conversions_api_access_token, '') <> ''
      and not exists (
        select 1 from public.meta_ad_account_tokens t
        where t.account_id = m.account_id and t.token_type = 'conversions_api'
      )
    );

  if unmigrated > 0 then
    raise exception '% brand(s) still hold a plaintext Meta token with no encrypted copy; aborting', unmigrated;
  end if;
end $$;

update public.meta_ad_accounts set access_token = '' where access_token <> '';
update public.meta_ad_accounts set conversions_api_access_token = null where conversions_api_access_token is not null;

alter table public.meta_ad_accounts
  add constraint meta_ad_accounts_access_token_not_plaintext check (access_token = '');
alter table public.meta_ad_accounts
  add constraint meta_ad_accounts_capi_token_not_plaintext check (conversions_api_access_token is null);
