# CheersAI Trial Strategy

## Current Approach: No Card Required + Smart Limitations

### Trial Limits (14 days):
- ✅ 5 campaigns maximum
- ✅ 10 AI-generated posts
- ✅ 10 media uploads
- ✅ 1 social account connection
- ❌ No scheduling (immediate publish only)
- ❌ No team members

### Conversion Strategy:

#### 1. Progressive Engagement (Days 1-3)
- Welcome email series
- Quick win: "Create your first campaign in 2 minutes"
- Show success metrics: "Your post could reach 500+ locals"

#### 2. Value Demonstration (Days 4-10)
- Email when they hit 3 campaigns: "You're on fire! 🔥"
- Show time saved: "You've saved 4 hours this week"
- Case study email: "How The Red Lion increased bookings by 40%"

#### 3. Conversion Push (Days 11-14)
- Day 11: "Your trial ends in 3 days" + 20% discount offer
- Day 13: "Last chance - lock in founder pricing"
- Day 14: "Trial ending today" + extend by 7 days if they add card

### Smart Features to Encourage Conversion:

#### "Soft Walls" - Require Card For:
- Publishing to multiple accounts simultaneously
- Scheduling posts for future
- Advanced analytics
- Team collaboration
- Bulk campaign creation
- API access

#### "Value Moments" - Trigger Upgrade Prompts:
- After 3rd successful campaign
- When trying to create 6th campaign
- When attempting to schedule
- After positive AI generation

### Implementation Code Changes Needed:

1. **Update Trial Limits Check**:
```typescript
// In campaign creation
const canCreateCampaign = async (tenantId: string) => {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('subscription_tier, trial_ends_at')
    .eq('id', tenantId)
    .single();
    
  if (tenant.subscription_tier === 'free') {
    const { count } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
      
    if (count >= 5) {
      return { 
        allowed: false, 
        message: "Free trial limited to 5 campaigns. Upgrade to continue!",
        showUpgrade: true 
      };
    }
  }
  
  return { allowed: true };
};
```

2. **Add Upgrade Prompts**:
```typescript
// Component for upgrade nudges
const UpgradeNudge = ({ feature, benefit }) => (
  <div className="bg-primary/10 border border-primary/20 rounded-medium p-4">
    <p className="text-sm font-medium mb-2">
      🚀 Unlock {feature} with Pro
    </p>
    <p className="text-xs text-text-secondary mb-3">{benefit}</p>
    <Link href="/billing" className="btn-primary text-sm">
      Upgrade Now - 20% Off
    </Link>
  </div>
);
```

3. **Track Engagement Metrics**:
```sql
-- Add to database
CREATE TABLE user_engagement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  tenant_id UUID REFERENCES tenants(id),
  action VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track: campaigns_created, posts_generated, time_saved, etc.
```

### Email Drip Campaign:

#### Day 1: Welcome
**Subject**: Welcome to CheersAI! Here's your quick start guide 🥂
- Link to create first campaign
- Video tutorial (2 min)
- Your trial includes...

#### Day 3: First Success
**Subject**: Create your weekend special post in 30 seconds
- Template for Friday night special
- One-click generation
- Show example from similar pub

#### Day 7: Case Study
**Subject**: How The King's Arms filled their quiz night
- Real customer story
- Show the campaigns they used
- Results: 40% increase in Tuesday traffic

#### Day 11: Urgency
**Subject**: Only 3 days left - don't lose your campaigns!
- Your 5 campaigns will be saved
- Special offer: 20% off first 3 months
- "Add card now, charged only after trial"

#### Day 14: Last Chance
**Subject**: Your trial ends today - keep your momentum!
- Everything you'll lose
- Founder pricing: £23/month (usually £29)
- "Extend trial by 7 days" button

### Metrics to Track:

1. **Trial-to-Paid Conversion Rate**
   - Target: 15-20% without card
   - vs 40-60% with card required
   - But 5x more trials = more total customers

2. **Activation Metrics**:
   - % who create first campaign: Target 60%
   - % who generate 3+ posts: Target 40%
   - % who connect social: Target 30%

3. **Leading Indicators**:
   - Day 3 activation rate
   - Campaigns per trial user
   - Time to first value

### A/B Test Options:

1. **Trial Length**: 7 vs 14 vs 21 days
2. **Campaign Limits**: 3 vs 5 vs 10
3. **Discount Offers**: 20% vs first month free
4. **Card Timing**: Never vs day 7 vs at limit

### Competitive Advantages of This Approach:

✅ **Lower friction** than competitors
✅ **Higher volume** of trials to learn from
✅ **Better product-market fit** data
✅ **Word-of-mouth** from free users
✅ **Upgrade path** is natural, not forced

### When to Require Card:

Only consider requiring card upfront when:
- Conversion rate is consistently >20%
- CAC is too high from free trials
- Support burden is unsustainable
- You have strong brand recognition

### Alternative: Freemium Model

Consider offering:
- **Free Forever**: 1 campaign/month, basic features
- **Starter**: £29/month
- **Pro**: £59/month
- **Enterprise**: Custom

This keeps non-converters engaged and can upsell later.