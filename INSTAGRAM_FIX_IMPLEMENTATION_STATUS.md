# Instagram Integration Fix - Implementation Status

## ✅ COMPLETED FIXES

### 1. Removed Broken Instagram OAuth Files
- ✅ Deleted `/app/api/auth/callback/instagram-business/route.ts`
- ✅ Deleted `/app/api/social/connect/instagram/route.ts`
- ✅ Deleted `/components/social/instagram-connect-button.tsx`

### 2. Updated OAuth Flow to Use Facebook
- ✅ Modified `/app/api/social/connect/route.ts`:
  - Unified Facebook and Instagram to use same OAuth flow
  - Using Facebook OAuth URL: `facebook.com/v23.0/dialog/oauth`
  - Requesting correct scopes including `instagram_basic`, `instagram_content_publish`
  - Using Graph API v23.0 (current until May 29, 2025)

### 3. Fixed Callback Handler
- ✅ Updated `/app/api/social/callback/route.ts`:
  - Exchanges code for short-lived token
  - Converts to long-lived token (~60 days)
  - Gets Facebook Pages with their tokens
  - Checks each page for Instagram Business Account
  - Stores Page access token (not user token) for Instagram API calls
  - Adds metadata storage for profile picture and follower count

### 4. Database Updates
- ✅ Created migration `/supabase/migrations/020_instagram_fix.sql`:
  - Adds metadata JSONB column for Instagram-specific data
  - Marks existing Instagram connections as inactive
  - Documents proper token usage in column comments

### 5. Environment Variables
- ✅ Updated `.env.example`:
  - Marked Instagram app credentials as deprecated
  - Added comments explaining Instagram now uses Facebook OAuth
  - Noted that Instagram Basic Display API was shut down Dec 4, 2024

### 6. Instagram Publishing Code
- ✅ Updated `/lib/social/instagram.ts`:
  - Changed all API calls to v23.0
  - Updated to use `social_connections` table (not `social_accounts`)
  - Fixed to look for `instagram_business` platform
  - Uses `account_id` field for Instagram Business Account ID

### 7. UI Components
- ✅ Updated `/components/quick-post-modal.tsx`:
  - Fixed platform detection for `instagram_business`
  - Updated display name to show "Instagram Business"
  - Corrected icon styling for Instagram connections

## 📋 KEY CHANGES SUMMARY

### OAuth Flow Changes
| Before | After |
|--------|-------|
| `instagram.com/oauth/authorize` | `facebook.com/v23.0/dialog/oauth` |
| Instagram App ID: 1138649858083556 | Facebook App ID only |
| Invalid scopes: `instagram_business_*` | Valid scopes: `instagram_basic`, etc |
| User access token | Page access token |

### Database Changes
- Added `metadata` JSONB column for profile data
- Platform value: `instagram_business` (not just `instagram`)
- Stores Page ID and Page name for Instagram connections
- Token expiry tracking in `token_expires_at`

### API Version
- All Graph API calls updated from v18.0/v20.0 to v23.0
- Current version valid until May 29, 2025

## ⚠️ IMPORTANT NOTES

### Facebook App Configuration Required
1. Go to: https://developers.facebook.com/apps/1001401138674450
2. Ensure these products are added:
   - Facebook Login (standard, not "for Business")
   - Instagram Graph API
3. Set OAuth redirect URI: `https://cheersai.orangejelly.co.uk/api/social/callback`

### Security Action Required
**ROTATE THE FACEBOOK APP SECRET** - It was exposed in documentation:
- Current exposed secret: `089a1b973dab96f26e4cc6d053637d8a`
- Go to Facebook Developer Console → Settings → Basic → Reset App Secret
- Update in Vercel environment variables

### User Impact
- Existing Instagram connections will be marked as inactive
- Users must reconnect Instagram through Facebook
- Instagram Business Account must be linked to a Facebook Page
- Personal Instagram accounts cannot be connected (Business/Creator only)

## 🧪 TESTING CHECKLIST

### Local Testing
- [ ] Remove all Instagram environment variables
- [ ] Test Facebook OAuth flow
- [ ] Verify Instagram accounts are discovered from Pages
- [ ] Check Page access tokens are stored correctly
- [ ] Test posting to Instagram

### Production Deployment
1. [ ] Update environment variables (remove Instagram app credentials)
2. [ ] Run database migration
3. [ ] Rotate Facebook app secret
4. [ ] Test with admin Facebook account
5. [ ] Monitor error logs for OAuth failures

## 🚀 DEPLOYMENT STEPS

1. **Environment Variables**
   ```bash
   # Remove these from Vercel:
   INSTAGRAM_APP_ID
   INSTAGRAM_APP_SECRET
   INSTAGRAM_VERIFY_TOKEN
   
   # Update Facebook app secret after rotation:
   FACEBOOK_APP_SECRET=new_secret_after_rotation
   ```

2. **Database Migration**
   ```bash
   # Run in Supabase SQL editor:
   -- Contents of 020_instagram_fix.sql
   ```

3. **Deploy Code**
   ```bash
   git add .
   git commit -m "Fix Instagram OAuth to use Facebook Graph API v23.0"
   git push
   ```

4. **Post-Deployment**
   - Monitor logs for any OAuth errors
   - Test with a real Instagram Business account
   - Update user documentation

## 📚 REFERENCES

- [Instagram Business API Documentation](https://developers.facebook.com/docs/instagram-api)
- [Facebook OAuth Flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow)
- [Graph API v23.0 Changelog](https://developers.facebook.com/docs/graph-api/changelog/version23.0)
- GitHub Issue: #44

## ✨ SUCCESS CRITERIA

- [ ] No more "Error validating application" errors
- [ ] Users can connect Instagram via Facebook OAuth
- [ ] Instagram posts publish successfully
- [ ] Page access tokens stored and used correctly
- [ ] Token expiry dates tracked
- [ ] No exposed secrets in codebase

---

*Implementation completed by Claude Code following senior developer review and approval.*
*Instagram Basic Display API deprecated December 4, 2024 - now using Facebook OAuth + Instagram Graph API.*