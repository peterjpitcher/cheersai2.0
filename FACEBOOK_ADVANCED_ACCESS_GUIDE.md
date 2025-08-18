# Facebook Advanced Access Guide for public_profile

## Current Status
- **Product**: Facebook Login for Business
- **Permission**: public_profile
- **Current Access Level**: Standard
- **Required Access Level**: Advanced

## Why This Is Blocking You
Facebook Login for Business requires Advanced Access to the `public_profile` permission. Without it, the OAuth flow will fail even if all redirect URIs are correctly configured.

## Option 1: Get Advanced Access (Recommended for Production)

### Steps:
1. Click **"Get Advanced Access"** button in Facebook Login settings
2. You'll need to complete:
   - **Business Verification** (if not already done)
   - **App Review** for public_profile permission
   - **Data Use Checkup**

### What You'll Need for App Review:
- **Privacy Policy URL**: ✅ Already set (https://cheersai.orangejelly.co.uk/privacy)
- **Terms of Service URL**: ✅ Already set (https://cheersai.orangejelly.co.uk/terms)
- **App Icon**: Upload a 1024x1024 icon
- **App Description**: Explain how your app uses Facebook Login
- **Screencast**: Record a video showing the login flow
- **Test User Instructions**: Provide test credentials

### Timeline:
- Business Verification: 2-5 business days
- App Review: 5-7 business days

## Option 2: Use Regular Facebook Login (Faster Alternative)

If you need to get this working immediately, you can switch from "Facebook Login for Business" to regular "Facebook Login":

### Steps:
1. Go to your app dashboard
2. Remove "Facebook Login for Business" product
3. Add "Facebook Login" product instead
4. Configure the same settings:
   - Valid OAuth Redirect URIs: 
     - `https://cheersai.orangejelly.co.uk/api/social/callback`
   - Client OAuth Login: ON
   - Web OAuth Login: ON

### Differences:
- Regular Facebook Login works with Standard Access to public_profile
- No Advanced Access required
- Can be used immediately
- Limitations: Cannot use some enterprise features

## Option 3: Development Mode Testing (Immediate)

While waiting for Advanced Access, you can test with:

### Test Users:
1. Go to App Roles > Test Users
2. Create test accounts
3. These accounts can use the app even without Advanced Access

### App Roles:
1. Go to App Roles > Roles
2. Add yourself and team members as:
   - Administrators
   - Developers
   - Testers
3. These roles can use the app without Advanced Access

## Current Configuration Status

### ✅ Correctly Configured:
- Valid OAuth Redirect URIs are set correctly
- Client OAuth Login is ON
- Web OAuth Login is ON
- Enforce HTTPS is ON
- Deauthorize callback URL is set
- Data Deletion Request URL is set

### ❌ Needs Attention:
- public_profile permission needs Advanced Access
- App might need Business Verification

## Instagram Settings Status

### ✅ Working:
- Instagram Business Login is properly configured
- Redirect URI is correct: `https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business`
- Webhooks are configured
- Test account (theanchor.pub) is connected

### Note:
Instagram login should work independently since it's a separate app with its own configuration.

## Recommended Action Plan

### For Immediate Testing:
1. Add yourself as an Admin/Developer in App Roles
2. Create test users for development
3. Test the OAuth flow with these accounts

### For Production:
1. Either:
   - Option A: Complete App Review for Advanced Access (7-10 days)
   - Option B: Switch to regular Facebook Login (immediate)
2. Test thoroughly with real accounts once approved

## Testing Your Current Setup

1. **Check if you're an app admin/developer**:
   - Go to App Roles > Roles
   - Verify your Facebook account is listed

2. **If you are an admin/developer**:
   - The OAuth flow should work for YOUR account
   - Even without Advanced Access

3. **Test with debug endpoint**:
   - Visit: https://cheersai.orangejelly.co.uk/api/debug-oauth
   - Verify all URLs match

## Code Verification

The code is correctly configured to use:
- Facebook redirect: `https://cheersai.orangejelly.co.uk/api/social/callback`
- Instagram redirect: `https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business`

These match what's in your Facebook/Instagram app settings, so the technical setup is correct.

## Summary

The "URL blocked" error is likely because:
1. Facebook Login for Business requires Advanced Access to public_profile
2. Your app only has Standard Access
3. Solution: Either get Advanced Access OR switch to regular Facebook Login

For immediate testing, add yourself as an app admin and test with your own account.