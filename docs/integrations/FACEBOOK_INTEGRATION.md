# Facebook Integration Guide for CheersAI

## Overview

This comprehensive guide covers all aspects of Facebook integration for CheersAI, including OAuth setup, app review process, troubleshooting, and production deployment. This document consolidates all Facebook-related documentation.

## Current Configuration Status

### App Information
- **Facebook App ID**: 1001401138674450
- **App Name**: CheersAI
- **App Domain**: cheersai.orangejelly.co.uk
- **Privacy Policy**: https://cheersai.orangejelly.co.uk/privacy
- **Terms of Service**: https://cheersai.orangejelly.co.uk/terms

### Redirect URIs
- **Facebook OAuth**: `https://cheersai.orangejelly.co.uk/api/social/callback`
- **Instagram Business**: `https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business`

## Facebook OAuth Setup & Troubleshooting

### Required Facebook App Settings

#### 1. Facebook Login Settings
Navigate to: https://developers.facebook.com/apps/1001401138674450/fb-login/settings/

**Valid OAuth Redirect URIs (EXACT URLs required):**
```
https://cheersai.orangejelly.co.uk/api/social/callback
https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business
```

#### 2. Basic Settings
Navigate to: https://developers.facebook.com/apps/1001401138674450/settings/basic/

**Required Configuration:**
- **App Domains**: `cheersai.orangejelly.co.uk` (without https://)
- **Site URL**: `https://cheersai.orangejelly.co.uk`
- **Privacy Policy URL**: `https://cheersai.orangejelly.co.uk/privacy`
- **Terms of Service URL**: `https://cheersai.orangejelly.co.uk/terms`

#### 3. Facebook Login Settings Toggles
**Required Settings (Must be ON):**
- ✅ Client OAuth Login
- ✅ Web OAuth Login
- ✅ Enforce HTTPS
- ✅ Use Strict Mode for Redirect URIs

### Common OAuth Issues & Solutions

#### Issue: "URL blocked: This redirect failed because the redirect URI is not white-listed"

**Root Causes:**
1. Dynamic URL generation creating inconsistent redirect URIs
2. Facebook's strict EXACT matching requirement
3. Missing or incorrect redirect URIs in app settings

**Solutions:**
1. **Ensure consistent production URL usage:**
   ```typescript
   // WRONG - Dynamic URL detection
   const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
     `${request.nextUrl.protocol}//${request.nextUrl.host}`;

   // CORRECT - Use consistent production URL
   const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cheersai.orangejelly.co.uk";
   ```

2. **Hardcode production URL for Facebook if needed:**
   ```typescript
   // In /app/api/social/connect/route.ts
   case "facebook":
     // Always use production URL for Facebook
     const fbRedirectUri = "https://cheersai.orangejelly.co.uk/api/social/callback";
     
     authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
       `client_id=${FACEBOOK_APP_ID}&` +
       `redirect_uri=${encodeURIComponent(fbRedirectUri)}&` +
       `state=${state}&` +
       `scope=${fbScopes}`;
     break;
   ```

3. **Verification Steps:**
   - Test debug endpoint: https://cheersai.orangejelly.co.uk/api/debug-oauth
   - Clear browser cache and cookies for facebook.com
   - Try in incognito/private window

## Facebook App Review Process

### Current Status
- **Product**: Facebook Login for Business
- **Permission**: public_profile
- **Current Access Level**: Standard
- **Required Access Level**: Advanced

### Advanced Access Requirements

#### Why Advanced Access Is Needed
Facebook Login for Business requires Advanced Access to the `public_profile` permission. Without it, the OAuth flow will fail even if all redirect URIs are correctly configured.

#### Steps to Get Advanced Access

1. **Click "Get Advanced Access" button** in Facebook Login settings
2. **Complete Requirements:**
   - Business Verification (if not already done)
   - App Review for public_profile permission
   - Data Use Checkup

#### App Review Documentation Requirements

**What You'll Need:**
- **Privacy Policy URL**: ✅ Already set (https://cheersai.orangejelly.co.uk/privacy)
- **Terms of Service URL**: ✅ Already set (https://cheersai.orangejelly.co.uk/terms)
- **App Icon**: Upload a 1024x1024 icon
- **App Description**: Explain how your app uses Facebook Login
- **Screencasts**: Record videos showing the login flow
- **Test User Instructions**: Provide test credentials

**Timeline:**
- Business Verification: 2-5 business days
- App Review: 5-7 business days

### Creating Effective Screencasts

#### Key Requirements
Facebook needs to see:
1. Real Meta login screens
2. Users granting permissions
3. Complete end-to-end experience

#### Setup for Recording

**Step 1: Set Up Test Accounts (30 minutes)**
1. **Add Instagram Testers:**
   - Go to App Roles → Roles → Instagram Testers
   - Add your Instagram username
   - Accept invitation in Instagram app

2. **Convert to Business Account:**
   - In Instagram: Settings → Account → Switch to Professional Account
   - Choose "Business"
   - Connect to Facebook Page

**Step 2: Configure for Real OAuth (1 hour)**
1. **Update Environment Variables:**
   ```bash
   NEXT_PUBLIC_APP_URL=https://cheersai.orangejelly.co.uk
   NEXT_PUBLIC_FACEBOOK_APP_ID=1001401138674450
   ```

2. **Disable Demo Mode:**
   ```typescript
   // In /app/api/social/connect/route.ts
   const IS_DEMO_MODE = false;
   ```

#### Screencast Content (3 recordings needed)

**Screencast #1: facebook_login (2-3 minutes)**
1. Start at CheersAI dashboard (0:00-0:10)
2. Navigate to Social Connections (0:10-0:20)
3. **CRITICAL: Show Real OAuth Flow (0:20-1:30)**
   - Shows redirect to facebook.com
   - Shows Facebook login screen
   - Shows permission grant screen
   - User clicks "Allow"
4. Return to CheersAI (1:30-2:00)
5. Display retrieved account info (2:00-2:30)

**Screencast #2: Content Publishing (3 minutes)**
1. Show connected account (0:00-0:10)
2. Create campaign (0:10-1:00)
3. Generate AI content (1:00-1:30)
4. Schedule post (1:30-2:00)
5. Show in queue (2:00-2:30)

**Screencast #3: Analytics (2-3 minutes)**
1. Navigate to Analytics (0:00-0:20)
2. Show data retrieval (0:20-1:00)
3. Display metrics (1:00-2:00)
4. Show optimization features (2:00-2:30)

#### Recording Best Practices

**Tools:**
- OBS Studio (free) or Loom
- Annotation tool for adding arrows/text

**✅ DO:**
- Show REAL facebook.com OAuth screens
- Use actual Facebook Business account (as tester)
- Display actual data being retrieved
- Add clear annotations and narration
- Keep videos under 3 minutes
- Show complete flow from start to finish

**❌ DON'T:**
- Use demo mode
- Skip OAuth screens
- Use mock data
- Make videos without captions
- Assume reviewers understand your app

## Alternative Solutions

### Option 1: Regular Facebook Login (Faster Alternative)

If you need immediate access, switch from "Facebook Login for Business" to regular "Facebook Login":

**Steps:**
1. Remove "Facebook Login for Business" product
2. Add "Facebook Login" product instead
3. Configure same settings
4. Use Standard Access to public_profile

**Differences:**
- Works with Standard Access
- No Advanced Access required
- Immediate availability
- Some enterprise features unavailable

### Option 2: Development Mode Testing

While waiting for Advanced Access:

**Test Users:**
1. Go to App Roles > Test Users
2. Create test accounts
3. Test accounts can use app without Advanced Access

**App Roles:**
1. Add team members as Administrators/Developers/Testers
2. These roles bypass Advanced Access requirement

## App Review Documentation Template

### Executive Summary
- **Application Name:** CheersAI
- **Website:** https://cheersai.orangejelly.co.uk/
- **Industry:** Hospitality Technology (SaaS)
- **Target Market:** UK Pubs, Bars, and Restaurants

### Problem We Solve
Independent hospitality businesses in the UK face:
- Time constraints for social media management
- Resource limitations
- Technical barriers
- Missing optimal posting windows

### Our Solution
CheersAI provides:
- AI-powered content generation
- Multi-platform publishing
- Smart scheduling
- Performance analytics
- Industry-specific features

### Permissions Justification

**public_profile:**
- **Purpose:** User identification and account verification
- **Usage:** Display user name and profile for account management
- **Value:** Ensures correct account connection for multi-venue management

### Data Handling
**From Facebook:**
- User ID and basic profile information
- Account verification data
- No private content or personal data beyond profile

**Storage:**
- UK-based servers (Supabase)
- Encrypted at rest and in transit
- GDPR compliant

### Test Account Information
```
Test Account:
Email: reviewer@cheersai.com
Password: ReviewTest2025!
Access: Full features with sample data
Valid until: December 2025
```

## Production Deployment Checklist

### Before App Review Submission
- [ ] All redirect URIs configured in Facebook app
- [ ] Privacy Policy and Terms of Service live
- [ ] Test accounts created and configured
- [ ] Screencasts recorded with real OAuth flow
- [ ] Demo mode disabled for recordings
- [ ] All environment variables properly set

### After App Review Approval
- [ ] Enable production OAuth flow
- [ ] Remove demo mode completely
- [ ] Test with real user accounts
- [ ] Monitor error logs
- [ ] Update documentation
- [ ] Notify users of availability

### Monitoring & Maintenance
- [ ] Set up error monitoring for OAuth failures
- [ ] Regular testing of auth flows
- [ ] Token refresh mechanisms
- [ ] User notification for connection issues
- [ ] Backup authentication methods

## Troubleshooting Guide

### Common Issues

**Issue 1: Settings won't save in Facebook Developer Console**
- Use Chrome in incognito mode
- Clear browser cache and cookies for developers.facebook.com
- Try Facebook Login for Business instead of regular Facebook Login

**Issue 2: "Invalid OAuth redirect URI"**
- Ensure URL encoding with `encodeURIComponent()`
- Check for trailing slashes
- Verify HTTPS vs HTTP
- Confirm exact match with app settings

**Issue 3: OAuth works for admin but not regular users**
- App is in Development Mode
- Need App Review for public access
- Add users as testers for immediate access

### Emergency Fallback

If dynamic URL detection continues causing issues:

```typescript
// Hardcode production URLs for Facebook
const PRODUCTION_REDIRECT_URIS = {
  facebook: "https://cheersai.orangejelly.co.uk/api/social/callback",
  instagram: "https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business"
};
```

### Debug Tools

**Test OAuth Flow:**
Visit: https://cheersai.orangejelly.co.uk/api/debug-oauth

**Check Configuration:**
- Redirect URIs match exactly
- Environment variables set correctly
- App settings properly configured

## Resources & References

### Official Documentation
- [Facebook App Review Guidelines](https://developers.facebook.com/docs/app-review/)
- [Screen Recording Guide](https://developers.facebook.com/docs/app-review/resources/sample-submissions/screen-recordings)
- [App Roles Documentation](https://developers.facebook.com/docs/development/build-and-test/app-roles/)

### Support Contacts
- **Technical Contact:** peter@orangejelly.co.uk
- **Response Time:** Within 24 hours
- **Business Hours:** 9 AM - 6 PM GMT

### App URLs
- **Dashboard:** https://developers.facebook.com/apps/1001401138674450/
- **Login Settings:** https://developers.facebook.com/apps/1001401138674450/fb-login/settings/
- **Basic Settings:** https://developers.facebook.com/apps/1001401138674450/settings/basic/

## Success Stories & Tips

**Based on Developer Research:**
- Show complete OAuth flow (most important)
- Use real test accounts
- Add clear annotations
- Be persistent (2-3 submissions common)
- Request call with Facebook support if needed
- Consider hiring consultant for complex cases

**Common Success Factors:**
- Complete end-to-end flow demonstration
- Real API calls, not simulations
- Clear business justification
- Proper documentation
- Responsive support contact

---

*This document contains comprehensive Facebook integration guidance for CheersAI. Last updated: January 2025*