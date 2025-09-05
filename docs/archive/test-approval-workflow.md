# Approval Workflow Implementation Test Plan

## Manual Testing Steps

### 1. Database Migration
- [ ] Run the migration: `20250820090000_add_approval_status_to_campaign_posts.sql`
- [ ] Verify `approval_status` column exists with default value 'pending'
- [ ] Verify `approved_by` and `approved_at` columns exist
- [ ] Verify check constraint for approval_status values

### 2. New Post Creation
- [ ] Create a new campaign
- [ ] Generate posts for the campaign
- [ ] Verify all new posts have `approval_status = 'pending'`

### 3. Approval UI
- [ ] Navigate to campaign view
- [ ] Verify approval status badges appear on posts
- [ ] Verify pending posts show "Pending" badge with clock icon
- [ ] Verify approve/reject buttons appear for pending posts

### 4. Approval Actions
- [ ] Click approve button on a pending post
- [ ] Verify post status changes to "Approved" with green badge
- [ ] Verify approve button disappears and reject button appears
- [ ] Click reject button on an approved post
- [ ] Verify post status changes to "Rejected" with red badge

### 5. Publishing Restrictions
- [ ] Try to publish a pending post
- [ ] Verify warning message appears
- [ ] Verify publish button is disabled for non-approved posts
- [ ] Approve a post and verify publish button becomes enabled

### 6. Publish All Button
- [ ] With mixed approval statuses
- [ ] Verify "Publish All" shows count of approved posts only
- [ ] Verify only approved posts get scheduled when clicked

### 7. API Validation
- [ ] Make direct API call to publish unapproved post
- [ ] Verify 403 error is returned
- [ ] Verify appropriate error message

## Database Schema Validation

```sql
-- Check the approval_status column exists with proper constraints
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns 
WHERE table_name = 'campaign_posts' 
AND column_name LIKE '%approval%';

-- Check constraint exists
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name LIKE '%approval_status%';
```

## Test Data Setup

```sql
-- Create test campaign posts with different approval statuses
INSERT INTO campaign_posts (campaign_id, post_timing, content, scheduled_for, approval_status)
VALUES 
  ('test-campaign-id', 'day_before', 'Pending post content', '2025-08-21 12:00:00', 'pending'),
  ('test-campaign-id', 'day_of', 'Approved post content', '2025-08-21 12:00:00', 'approved'),
  ('test-campaign-id', 'week_before', 'Rejected post content', '2025-08-21 12:00:00', 'rejected');
```

## Expected Behavior

1. **New posts default to 'pending' status**
2. **Only approved posts can be published**
3. **UI clearly shows approval status**
4. **Approval actions update database correctly**
5. **Publishing restrictions enforced at API level**