# Content Calendar & Publishing System - Bug Fixes & Solutions

## Executive Summary

Four critical bugs are preventing the content calendar and publishing system from working correctly. All issues have been identified with specific code locations and solutions provided.

## 🐛 Critical Bugs Identified

### Bug #1: Calendar Shows No Content
**Severity**: 🔴 Critical  
**Location**: `/app/calendar/page.tsx` line 69  
**Issue**: Queries non-existent `posts` table instead of `campaign_posts`  
**Impact**: Calendar appears empty even when posts exist  

### Bug #2: Custom Dates Ignored in Campaign
**Severity**: 🔴 Critical  
**Location**: `/app/campaigns/[id]/generate/page.tsx` lines 84-121  
**Issue**: Hardcoded timings used instead of user selections  
**Impact**: Users can't schedule posts for their chosen dates  

### Bug #3: No Publish/Approval Workflow
**Severity**: 🔴 Critical  
**Location**: Missing functionality  
**Issue**: No way to move posts from draft to scheduled status  
**Impact**: Generated content never publishes  

### Bug #4: One Content for All Platforms
**Severity**: 🟡 High  
**Location**: `/app/campaigns/[id]/generate/page.tsx`  
**Issue**: Generates single content instead of platform-specific versions  
**Impact**: Poor engagement due to non-optimized content  

## 📝 Detailed Solutions

### Fix #1: Calendar Query Correction

**File**: `/app/calendar/page.tsx`

```typescript
// CURRENT (BROKEN) - Line 69
const { data, error } = await supabase
  .from('posts')  // ❌ Wrong table
  .select(`*, campaigns(name)`)

// FIXED
const { data, error } = await supabase
  .from('campaign_posts')  // ✅ Correct table
  .select(`
    *,
    campaign:campaigns(name, event_date)
  `)
  .or(`tenant_id.eq.${tenantId},campaign.tenant_id.eq.${tenantId}`)
  .gte('scheduled_for', startDate)
  .lte('scheduled_for', endDate)
  .order('scheduled_for', { ascending: true });
```

### Fix #2: Use User-Selected Schedule

**File**: `/app/campaigns/[id]/generate/page.tsx`

```typescript
// CURRENT (BROKEN) - Lines 84-121
for (const timing of POST_TIMINGS) {  // ❌ Ignores user selections
  // Generate posts...
}

// FIXED
// First, fetch the campaign with user selections
const { data: campaign } = await supabase
  .from('campaigns')
  .select('selected_timings, custom_dates')
  .eq('id', params.id)
  .single();

// Use user selections
const timingsToGenerate = campaign.selected_timings || [];
const customDates = campaign.custom_dates || [];

// Generate for selected timings
for (const timing of timingsToGenerate) {
  // Generate post for this timing
}

// Generate for custom dates
for (const customDate of customDates) {
  // Generate post for this date
}
```

**Also need to update campaign creation** to save selections:

```typescript
// File: /app/campaigns/new/page.tsx
// Add to campaign creation
const { data, error } = await supabase
  .from('campaigns')
  .insert({
    // ... existing fields
    selected_timings: selectedTimings,  // Save checkbox selections
    custom_dates: customDates,          // Save custom dates
  });
```

### Fix #3: Add Publish Workflow

**Create new file**: `/app/campaigns/[id]/page.tsx`

```typescript
// Campaign detail page with approve/publish functionality
export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  const { user, tenantId } = await getUser();
  
  // Fetch campaign and its posts
  const { data: campaign } = await supabase
    .from('campaigns')
    .select(`
      *,
      campaign_posts(*)
    `)
    .eq('id', params.id)
    .single();

  return (
    <div>
      <h1>{campaign.name}</h1>
      
      {/* Show all generated posts */}
      <div className="space-y-4">
        {campaign.campaign_posts.map(post => (
          <PostCard 
            key={post.id}
            post={post}
            onApprove={() => updatePostStatus(post.id, 'scheduled')}
            onEdit={() => router.push(`/posts/${post.id}/edit`)}
            onDelete={() => deletePost(post.id)}
          />
        ))}
      </div>
      
      {/* Bulk actions */}
      <div className="flex gap-4 mt-6">
        <Button onClick={publishAll}>
          Publish All Posts
        </Button>
        <Button variant="outline" onClick={saveDrafts}>
          Save as Drafts
        </Button>
      </div>
    </div>
  );
}

// Action to publish all posts
async function publishAll() {
  await supabase
    .from('campaign_posts')
    .update({ status: 'scheduled' })
    .eq('campaign_id', params.id)
    .eq('status', 'draft');
}
```

### Fix #4: Platform-Specific Content Generation

**File**: `/app/campaigns/[id]/generate/page.tsx`

```typescript
// CURRENT (BROKEN) - One content for all platforms
const generateContent = async (timing: string) => {
  // Generates single content
  const response = await fetch('/api/generate', {
    body: JSON.stringify({
      platforms: ['twitter', 'facebook'],  // ❌ Sends all platforms
    }),
  });
};

// FIXED - Generate per platform
const generateContent = async (timing: string, eventDate: Date) => {
  const platforms = profile.social_platforms || ['twitter', 'facebook'];
  const generatedPosts = [];
  
  // Generate separate content for each platform
  for (const platform of platforms) {
    const response = await fetch('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        platform,  // ✅ Single platform
        campaignType,
        eventDetails,
        timing,
        brandProfile,
      }),
    });
    
    const { content } = await response.json();
    
    // Create platform-specific post
    generatedPosts.push({
      campaign_id: params.id,
      tenant_id: tenantId,
      content,
      platform,  // Store single platform
      scheduled_for: calculateScheduleDate(eventDate, timing),
      status: 'draft',
    });
  }
  
  // Bulk insert all platform-specific posts
  await supabase
    .from('campaign_posts')
    .insert(generatedPosts);
};
```

### Fix #5: Quick Post Status

**File**: `/components/quick-post-modal.tsx`

```typescript
// CURRENT (BROKEN) - Line 243
status: scheduleType === "now" ? "scheduled" : "draft",  // ❌ Wrong status

// FIXED
status: scheduleType === "now" ? "published" : 
        scheduleType === "scheduled" ? "scheduled" : "draft",
is_quick_post: true,  // ✅ Uncomment this line (244)
```

## 🏗️ Database Schema Updates Needed

Add missing columns to campaigns table:

```sql
ALTER TABLE campaigns 
ADD COLUMN selected_timings TEXT[] DEFAULT ARRAY['week_before', 'day_before', 'day_of'],
ADD COLUMN custom_dates TIMESTAMPTZ[] DEFAULT ARRAY[]::TIMESTAMPTZ[];

-- Update campaign_posts to support single platform
ALTER TABLE campaign_posts 
ADD COLUMN platform TEXT,
ADD COLUMN is_quick_post BOOLEAN DEFAULT false;

-- Migrate existing data
UPDATE campaign_posts 
SET platform = platforms[1] 
WHERE platforms IS NOT NULL AND array_length(platforms, 1) > 0;
```

## 📋 Implementation Priority

1. **Fix #1** - Calendar Query (5 mins) - Immediate visibility fix
2. **Fix #5** - Quick Post Status (5 mins) - Enable immediate posting
3. **Fix #2** - Custom Schedule (30 mins) - Core functionality 
4. **Fix #3** - Publish Workflow (2 hours) - Enable content publishing
5. **Fix #4** - Platform Optimization (1 hour) - Improve content quality

## 🎯 Testing Checklist

After implementing fixes, verify:

- [ ] Calendar shows all scheduled posts
- [ ] Quick posts publish immediately when "Post now" selected
- [ ] Custom dates in campaigns create posts
- [ ] Unchecked timings don't generate posts
- [ ] Campaign detail page shows all generated posts
- [ ] "Publish All" moves posts from draft to scheduled
- [ ] Each platform gets optimized content
- [ ] Published posts appear in publishing queue

## 🚀 Quick Wins

Start with Fix #1 and #5 - these are one-line changes that will immediately improve the user experience:

```bash
# Fix calendar in 1 line
sed -i "s/from('posts')/from('campaign_posts')/" app/calendar/page.tsx

# Fix quick post status in 1 line  
sed -i "s/scheduleType === \"now\" ? \"scheduled\"/scheduleType === \"now\" ? \"published\"/" components/quick-post-modal.tsx
```

## 📊 Expected Impact

Once these fixes are implemented:
- Users will see their content in the calendar
- Custom scheduling will work as expected
- Content will actually publish on schedule
- Each platform will get optimized content
- Engagement rates should improve significantly

---

*These fixes address all reported issues and will restore full functionality to the content calendar and publishing system.*