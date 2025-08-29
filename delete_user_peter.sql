-- =====================================================
-- DELETE USER: peter@orangejelly.co.uk
-- This will delete the user and ALL related data
-- =====================================================

-- Start transaction
BEGIN;

-- Get the user ID
DO $$
DECLARE
    v_user_id uuid;
    v_tenant_id uuid;
BEGIN
    -- Find the user
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE email = 'peter@orangejelly.co.uk';
    
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User not found: peter@orangejelly.co.uk';
        RETURN;
    END IF;
    
    RAISE NOTICE 'Found user ID: %', v_user_id;
    
    -- Get tenant ID if exists
    SELECT tenant_id INTO v_tenant_id
    FROM public.users
    WHERE id = v_user_id;
    
    IF v_tenant_id IS NOT NULL THEN
        RAISE NOTICE 'Found tenant ID: %', v_tenant_id;
        
        -- Delete campaign posts for this tenant
        DELETE FROM public.campaign_posts 
        WHERE campaign_id IN (
            SELECT id FROM public.campaigns WHERE tenant_id = v_tenant_id
        );
        RAISE NOTICE 'Deleted campaign posts';
        
        -- Delete campaigns
        DELETE FROM public.campaigns WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted campaigns';
        
        -- Delete brand profiles
        DELETE FROM public.brand_profiles WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted brand profiles';
        
        -- Delete brand voice profiles
        DELETE FROM public.brand_voice_profiles WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted brand voice profiles';
        
        -- Delete social accounts
        DELETE FROM public.social_accounts WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted social accounts';
        
        -- Delete media assets
        DELETE FROM public.media_assets WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted media assets';
        
        -- Delete tenant logos
        DELETE FROM public.tenant_logos WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted tenant logos';
        
        -- Delete watermark settings
        DELETE FROM public.watermark_settings WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted watermark settings';
        
        -- Delete posting schedules
        DELETE FROM public.posting_schedules WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted posting schedules';
        
        -- Delete content guardrails
        DELETE FROM public.content_guardrails WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted content guardrails';
        
        -- Delete user_tenants relationships
        DELETE FROM public.user_tenants WHERE tenant_id = v_tenant_id;
        RAISE NOTICE 'Deleted user_tenants relationships';
        
        -- Delete the tenant itself
        DELETE FROM public.tenants WHERE id = v_tenant_id;
        RAISE NOTICE 'Deleted tenant';
    END IF;
    
    -- Delete from users table
    DELETE FROM public.users WHERE id = v_user_id;
    RAISE NOTICE 'Deleted from users table';
    
    -- Delete from auth.users (this will cascade to auth tables)
    DELETE FROM auth.users WHERE id = v_user_id;
    RAISE NOTICE 'Deleted from auth.users';
    
    RAISE NOTICE '=== USER DELETION COMPLETE ===';
    RAISE NOTICE 'User peter@orangejelly.co.uk has been completely removed';
    
END $$;

-- Commit the transaction
COMMIT;

-- Verify deletion
SELECT 
    'Auth Users' as table_name,
    COUNT(*) as count 
FROM auth.users 
WHERE email = 'peter@orangejelly.co.uk'
UNION ALL
SELECT 
    'Public Users' as table_name,
    COUNT(*) as count 
FROM public.users 
WHERE email = 'peter@orangejelly.co.uk';