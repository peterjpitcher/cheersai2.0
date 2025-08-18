# Instagram OAuth Error Fix Guide

## Error Message
"Error validating application. Cannot get application info due to a system error."

## Root Causes
This error typically occurs when:
1. Instagram app secret is not set in production environment (Vercel)
2. Instagram app is in Development mode instead of Live mode
3. App credentials are incorrect or expired
4. Mismatch between app ID and app secret

## Immediate Checks

### 1. Debug Endpoint
Visit: https://cheersai.orangejelly.co.uk/api/debug-instagram

Check for:
- `app_secret_configured`: Should be `true`
- `app_validation.app_error`: Should be `null`
- If there's an error, it will show what's wrong

### 2. Vercel Environment Variables
You MUST add these to Vercel:

```
INSTAGRAM_APP_SECRET=554404bd201993ac8f7d055f33d4a530
```

**Important**: This is NOT prefixed with `NEXT_PUBLIC_` because it's a server-side secret.

### 3. Instagram App Mode
In your Instagram app settings (https://developers.facebook.com/apps/1138649858083556):
- Check if the app is in **Live** mode
- Development mode will cause authentication issues for non-admin users

## Step-by-Step Fix

### Step 1: Add Instagram App Secret to Vercel
1. Go to Vercel Dashboard
2. Select your project (cheersai)
3. Go to Settings > Environment Variables
4. Add:
   - Key: `INSTAGRAM_APP_SECRET`
   - Value: `554404bd201993ac8f7d055f33d4a530`
   - Environment: Production, Preview, Development
5. Save and redeploy

### Step 2: Verify Instagram App Settings
Go to: https://developers.facebook.com/apps/1138649858083556/instagram-business/settings/

Confirm:
- App is in **Live** mode (top right corner)
- OAuth Redirect URI is set to: `https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business`
- Deauthorize URL: `https://cheersai.orangejelly.co.uk/api/social/deauthorize`
- Data Deletion URL: `https://cheersai.orangejelly.co.uk/api/social/delete-data`

### Step 3: Check App Secret
In Instagram app settings:
1. Go to Settings > Basic
2. Click "Show" next to App Secret
3. Verify it matches: `554404bd201993ac8f7d055f33d4a530`
4. If different, update the Vercel environment variable

### Step 4: Test Authentication Flow

#### As App Admin (Should Work in Development Mode):
1. Make sure you're an admin of the Instagram app
2. Go to https://cheersai.orangejelly.co.uk/settings/connections
3. Click "Connect Instagram"
4. Should authenticate successfully

#### For Other Users (Requires Live Mode):
1. App must be in Live mode
2. OR add them as testers in App Roles

## Alternative: Using Facebook Token for Instagram

Since Facebook login is working, you can potentially use the Facebook access token to access Instagram Business accounts:

1. When users connect Facebook, request additional Instagram permissions
2. Use the Facebook Page access token to manage Instagram Business accounts
3. This bypasses the separate Instagram OAuth flow

## Code Verification

The code expects:
- Instagram App ID: `1138649858083556` (hardcoded)
- Instagram App Secret: From `process.env.INSTAGRAM_APP_SECRET`
- Redirect URI: `https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business`

All these must match exactly in:
1. Instagram app settings
2. Vercel environment variables
3. OAuth URL generation

## Testing Checklist

- [ ] Added `INSTAGRAM_APP_SECRET` to Vercel environment variables
- [ ] Redeployed application after adding environment variable
- [ ] Verified app is in Live mode (or testing as admin)
- [ ] Checked debug endpoint shows no errors
- [ ] Confirmed redirect URI matches exactly
- [ ] Tested in incognito/private browser window

## If Still Not Working

### Option 1: Reset App Secret
1. Generate new app secret in Instagram app settings
2. Update Vercel environment variable
3. Redeploy

### Option 2: Use Facebook Login Instead
Since Facebook is working, you can:
1. Use Facebook login to get Page access tokens
2. Use those tokens to access Instagram Business accounts
3. This is actually the recommended approach for businesses

### Option 3: Create New Instagram App
1. Create a fresh Instagram app
2. Configure all settings from scratch
3. Update app ID and secret in code and Vercel

## Debug Information

When the error occurs, check:
1. Vercel Function Logs for detailed error messages
2. Browser Developer Console for any client-side errors
3. Network tab to see the exact OAuth response

## Current Status

Based on the settings you provided:
- ✅ Instagram app exists and is configured
- ✅ Redirect URI is correct in app settings
- ✅ Webhooks are configured
- ✅ Test account (theanchor.pub) is connected
- ❌ App secret may not be in Vercel environment variables
- ❓ App mode (Development vs Live) needs verification

The most likely issue is the missing `INSTAGRAM_APP_SECRET` environment variable in Vercel.