# Facebook OAuth Redirect URI Fix

## The Problem
You're getting "URL blocked: This redirect failed because the redirect URI is not white-listed" because Facebook requires EXACT redirect URIs to be configured in your app settings.

## Root Cause Analysis
1. **Dynamic URL Generation**: Our code uses dynamic base URL detection which can result in different redirect URIs
2. **Facebook's Strict Matching**: Facebook requires the EXACT redirect URI - protocol, domain, path, everything must match perfectly
3. **Missing Configuration**: The redirect URIs haven't been properly added to Facebook App settings

## Required Facebook App Settings

### 1. Facebook Login Settings
Go to: https://developers.facebook.com/apps/1001401138674450/fb-login/settings/

**Add these EXACT URLs to "Valid OAuth Redirect URIs":**
```
https://cheersai.orangejelly.co.uk/api/social/callback
https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business
```

**Important**: Include BOTH URLs even if you're only using Facebook login. The Instagram one is for your separate Instagram app.

### 2. Basic Settings
Go to: https://developers.facebook.com/apps/1001401138674450/settings/basic/

**Configure these settings:**
- **App Domains**: `cheersai.orangejelly.co.uk` (without https://)
- **Site URL**: `https://cheersai.orangejelly.co.uk`
- **Privacy Policy URL**: `https://cheersai.orangejelly.co.uk/privacy`
- **Terms of Service URL**: `https://cheersai.orangejelly.co.uk/terms`

### 3. Facebook Login Settings Toggles
Go to: https://developers.facebook.com/apps/1001401138674450/fb-login/settings/

**Make sure these are ON:**
- ✅ Client OAuth Login
- ✅ Web OAuth Login
- ✅ Enforce HTTPS
- ✅ Use Strict Mode for Redirect URIs (this ensures exact matching)

### 4. Instagram App Settings (if using Instagram)
Go to: https://developers.facebook.com/apps/1138649858083556/instagram-business/settings/

**Add to "Valid OAuth Redirect URIs":**
```
https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business
```

## Code Fix Required

The issue is in `/app/api/social/connect/route.ts`. We need to ensure we're using the PRODUCTION URL consistently:

```typescript
// WRONG - Dynamic URL detection
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
  `${request.nextUrl.protocol}//${request.nextUrl.host}`;

// CORRECT - Use consistent production URL
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cheersai.orangejelly.co.uk";
```

## Verification Steps

1. **Test the Debug Endpoint**
   Visit: https://cheersai.orangejelly.co.uk/api/debug-oauth
   
   Check that:
   - `redirect_uris.actual_in_production` matches `redirect_uris.expected_by_facebook`
   - The `match` field shows `true`

2. **Clear Browser Cache**
   - Clear cookies for facebook.com
   - Try in an incognito/private window

3. **Test Connection**
   - Go to https://cheersai.orangejelly.co.uk/settings/connections
   - Click "Connect Facebook"
   - Should redirect to Facebook OAuth without errors

## Common Issues and Solutions

### Issue 1: "URL blocked" error persists
**Solution**: The redirect URI in Facebook settings must match EXACTLY. Check for:
- Trailing slashes (there shouldn't be any)
- HTTP vs HTTPS (must be HTTPS)
- www vs non-www (must match exactly)

### Issue 2: Settings won't save in Facebook Developer Console
**Solution**: This is a known Facebook bug. Try:
1. Add Facebook Login for Business product (not regular Facebook Login)
2. Use Chrome in incognito mode
3. Clear browser cache and cookies for developers.facebook.com

### Issue 3: "Invalid OAuth redirect URI" 
**Solution**: Facebook may require URL encoding. Make sure the redirect_uri parameter is properly encoded using `encodeURIComponent()`

## Testing Checklist

- [ ] Added `https://cheersai.orangejelly.co.uk/api/social/callback` to Facebook App's Valid OAuth Redirect URIs
- [ ] Added `https://cheersai.orangejelly.co.uk/api/auth/callback/instagram-business` to Instagram App's Valid OAuth Redirect URIs  
- [ ] Set App Domain to `cheersai.orangejelly.co.uk` in Basic Settings
- [ ] Enabled Client OAuth Login and Web OAuth Login
- [ ] Verified NEXT_PUBLIC_APP_URL is set to `https://cheersai.orangejelly.co.uk` in production
- [ ] Tested in incognito/private browser window
- [ ] Checked debug endpoint shows matching redirect URIs

## Emergency Fallback

If the dynamic URL detection continues to cause issues, we should hardcode the production URL for Facebook:

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

This ensures Facebook always gets the exact same redirect URI regardless of environment variables.