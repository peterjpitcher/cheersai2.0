-- Elevate peter@orangejelly.co.uk to professional account that never expires

-- First, get the tenant_id for peter@orangejelly.co.uk
DO $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Get tenant_id from users table
  SELECT tenant_id INTO v_tenant_id
  FROM users
  WHERE email = 'peter@orangejelly.co.uk'
  LIMIT 1;
  
  IF v_tenant_id IS NOT NULL THEN
    -- Update the tenant's subscription to professional tier
    UPDATE tenants
    SET 
      subscription_status = 'active',
      subscription_tier = 'professional',
      trial_ends_at = NULL,
      stripe_customer_id = COALESCE(stripe_customer_id, 'cus_manual_peter_professional'),
      stripe_subscription_id = COALESCE(stripe_subscription_id, 'sub_manual_peter_professional'),
      updated_at = NOW()
    WHERE id = v_tenant_id;
    
    RAISE NOTICE 'Successfully upgraded peter@orangejelly.co.uk to Professional tier (never expires)';
  ELSE
    RAISE NOTICE 'User peter@orangejelly.co.uk not found';
  END IF;
END $$;