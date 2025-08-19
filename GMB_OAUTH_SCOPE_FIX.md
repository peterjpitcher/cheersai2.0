# Google My Business OAuth Scope Configuration Fix

## Problem Identified

The Google Cloud Console OAuth consent screen has **NO SCOPES configured**. The application requests the `https://www.googleapis.com/auth/business.manage` scope, but it's not authorized in the consent screen.

## Step-by-Step Fix in Google Cloud Console

### 1. Navigate to OAuth Consent Screen
Go to: https://console.cloud.google.com/apis/credentials/consent

### 2. Click "Edit App" 
Click the "EDIT APP" button to modify the OAuth consent screen configuration.

### 3. Navigate to Scopes Section
- Click through the first screens (App information, etc.) using "SAVE AND CONTINUE"
- Stop when you reach the **"Scopes"** section

### 4. Add Required Scope
Click **"ADD OR REMOVE SCOPES"** and add the following scope:

**Required Scope:**
```
https://www.googleapis.com/auth/business.manage
```

**How to add it:**
1. In the "Manually add scopes" field at the bottom of the scope selection dialog
2. Enter: `https://www.googleapis.com/auth/business.manage`
3. Click "ADD TO TABLE"
4. Click "UPDATE" to save

### 5. Enable Required APIs
Go to: https://console.cloud.google.com/apis/library

Search for and **ENABLE** these APIs:
1. **Google Business Profile API** (formerly Google My Business API)
2. **Google Business Management API** (if available)

### 6. Verify OAuth Consent Screen Status
Ensure your OAuth consent screen is in **"Testing"** or **"Production"** status:
- Testing: Add test users who can authenticate
- Production: Requires Google verification for sensitive scopes

### 7. Add Test Users (if in Testing mode)
If your app is in Testing mode:
1. Go to OAuth consent screen
2. Scroll to "Test users" section
3. Click "ADD USERS"
4. Add the email addresses that will test the integration

## Current Code Status

The code has been updated and is correct:

### `/lib/social/google-my-business/client.ts` (Line 78)
```typescript
scope: 'https://www.googleapis.com/auth/business.manage',
```
✅ Using the correct single scope

### `/app/api/auth/google-my-business/callback/route.ts`
✅ Has state verification
✅ Has proper error handling
✅ Database columns have been added via migration 023

## After Configuration

Once you've configured the scope in Google Cloud Console:

1. **Clear any cached OAuth sessions** in your browser
2. **Test the connection:**
   - Go to https://cheersai.orangejelly.co.uk/settings/connections
   - Click "Connect" for Google My Business
   - You should now see the scope permission request
   - Authorize the application
   - The connection should succeed

## Debugging Tips

If it still fails after scope configuration:

1. **Check browser console** for specific errors
2. **Check server logs** for detailed error messages
3. **Verify the redirect URI** matches exactly:
   - In Google Cloud Console: `https://cheersai.orangejelly.co.uk/api/auth/google-my-business/callback`
   - Must match EXACTLY (including https://)

## Common Issues and Solutions

### Issue: "Access blocked: Authorization Error"
**Solution:** OAuth consent screen is not properly configured or app needs verification

### Issue: "Redirect URI mismatch"
**Solution:** Ensure the redirect URI in Google Cloud Console matches exactly with your application URL

### Issue: "Invalid scope"
**Solution:** The scope wasn't added correctly or the API isn't enabled

### Issue: "Insufficient permission"
**Solution:** The user account doesn't have Google Business Profile access

## Quick Test Command

After fixing the scope, you can test the OAuth URL generation:

```bash
curl https://cheersai.orangejelly.co.uk/api/auth/google-my-business/connect
```

Should return a valid `authUrl` that includes the scope parameter.

## Summary

The GMB OAuth is failing because:
1. ❌ No scopes are configured in Google Cloud Console
2. ✅ Code is requesting the correct scope
3. ✅ Database has been updated with required columns
4. ✅ OAuth flow is properly implemented

**Action Required:** Configure the `business.manage` scope in Google Cloud Console OAuth consent screen.

---

*Once the scope is configured, the GMB OAuth should work immediately without any code changes.*