do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meta_ad_accounts'
      and column_name = 'meta_pixel_id'
  ) then
    alter table public.meta_ad_accounts
      alter column meta_pixel_id drop default,
      alter column meta_pixel_id drop not null;

    update public.meta_ad_accounts
    set meta_pixel_id = null
    where meta_pixel_id = '757659911002159';
  end if;
end;
$$;
