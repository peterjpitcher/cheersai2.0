-- Check current status of The Anchor tenant
SELECT 
  id,
  name,
  subscription_status,
  subscription_tier,
  total_campaigns_created,
  created_at
FROM tenants 
WHERE name ILIKE '%anchor%';

-- Check how many campaigns actually exist
SELECT 
  t.name as tenant_name,
  t.total_campaigns_created as stored_count,
  COUNT(c.id) as actual_count
FROM tenants t
LEFT JOIN campaigns c ON c.tenant_id = t.id
WHERE t.name ILIKE '%anchor%'
GROUP BY t.id, t.name, t.total_campaigns_created;

-- Reset the campaign count to 0 for testing
-- UNCOMMENT THE LINE BELOW TO EXECUTE:
-- UPDATE tenants SET total_campaigns_created = 0 WHERE name ILIKE '%anchor%';

-- Alternative: Set to actual count if you want to keep accurate count
-- UPDATE tenants SET total_campaigns_created = (SELECT COUNT(*) FROM campaigns WHERE tenant_id = tenants.id) WHERE name ILIKE '%anchor%';

-- Verify the update
-- SELECT id, name, total_campaigns_created FROM tenants WHERE name ILIKE '%anchor%';