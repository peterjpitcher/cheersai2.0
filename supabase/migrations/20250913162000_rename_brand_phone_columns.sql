-- Rename brand_profiles phone columns to store raw user input (no formatting)
do $$
begin
  -- phone_e164 -> phone
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'brand_profiles' and column_name = 'phone_e164'
  ) and not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'brand_profiles' and column_name = 'phone'
  ) then
    alter table public.brand_profiles rename column phone_e164 to phone;
  end if;

  -- whatsapp_e164 -> whatsapp
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'brand_profiles' and column_name = 'whatsapp_e164'
  ) and not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'brand_profiles' and column_name = 'whatsapp'
  ) then
    alter table public.brand_profiles rename column whatsapp_e164 to whatsapp;
  end if;
end $$;

-- Update column comments
do $$
begin
  if exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='brand_profiles' and column_name='phone'
  ) then
    comment on column public.brand_profiles.phone is 'Primary phone number as entered by the user (no formatting applied)';
  end if;
  if exists (
    select 1 from information_schema.columns where table_schema='public' and table_name='brand_profiles' and column_name='whatsapp'
  ) then
    comment on column public.brand_profiles.whatsapp is 'WhatsApp/SMS number as entered by the user (optional)';
  end if;
end $$;

