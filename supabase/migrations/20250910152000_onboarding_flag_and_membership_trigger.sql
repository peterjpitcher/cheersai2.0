-- Add a first-class onboarding completion flag and a trigger to keep users.tenant_id in sync

-- 1) Onboarding completion flag
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.onboarding_complete IS 'Marks whether the user has completed onboarding. Used to gate /onboarding.';

-- 2) Trigger to backfill users.tenant_id from user_tenants on membership insert
CREATE OR REPLACE FUNCTION public.set_user_tenant_id_from_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.users u
     SET tenant_id = COALESCE(u.tenant_id, NEW.tenant_id)
   WHERE u.id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_user_tenant_id ON public.user_tenants;
CREATE TRIGGER trg_set_user_tenant_id
AFTER INSERT ON public.user_tenants
FOR EACH ROW
EXECUTE PROCEDURE public.set_user_tenant_id_from_membership();

