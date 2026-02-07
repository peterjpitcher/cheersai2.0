-- Prefer app_metadata for account scoping, fall back to user_metadata for legacy users.
create or replace function public.current_account_id()
returns uuid
language plpgsql
stable
as $$
declare
  claim text;
  account uuid;
begin
  claim := auth.jwt()->'app_metadata'->>'account_id';
  if claim is null or length(trim(claim)) = 0 then
    claim := auth.jwt()->'user_metadata'->>'account_id';
  end if;
  if claim is null or length(trim(claim)) = 0 then
    return null;
  end if;
  begin
    account := claim::uuid;
  exception when others then
    return null;
  end;
  return account;
end;
$$;

comment on function public.current_account_id is 'Resolves the application account id from Supabase JWT app_metadata (preferred) or user_metadata (legacy).';
