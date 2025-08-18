# Twitter/X and Google My Business Setup Guide

## 🐦 Twitter/X Integration Setup

### Step 1: Create Twitter/X App

1. **Go to Twitter Developer Portal**
   - Visit: https://developer.twitter.com/en/portal/dashboard
   - Sign in with your Twitter/X account

2. **Create a New App** (if you don't have one)
   - Click "Create Project"
   - Name: "CheersAI" (or your app name)
   - Use case: Select "Making a bot" or "Building tools for Twitter users"
   
3. **Configure OAuth 2.0 Settings**
   - In your app settings, find "User authentication settings"
   - Click "Set up" or "Edit"
   - Configure as follows:

   **App permissions:**
   - ✅ Read
   - ✅ Write
   - ✅ Direct Messages (optional)

   **Type of App:**
   - Web App, Automated App or Bot

   **App info:**
   - Callback URL: `https://cheersai.orangejelly.co.uk/api/auth/twitter/callback`
   - Website URL: `https://cheersai.orangejelly.co.uk`

4. **Get Your Credentials**
   - Go to "Keys and tokens" tab
   - You need:
     - **Client ID** (starts with uppercase letters)
     - **Client Secret** (longer string)
   - Save these securely!

### Step 2: Add Twitter Environment Variables

Add these to your `.env.local` file:

```env
# Twitter/X OAuth 2.0
TWITTER_CLIENT_ID=your_client_id_here
TWITTER_CLIENT_SECRET=your_client_secret_here
```

### Step 3: Add to Vercel Environment Variables

1. Go to: https://vercel.com/your-team/cheersai/settings/environment-variables
2. Add both variables:
   - `TWITTER_CLIENT_ID` - Your Client ID from Twitter
   - `TWITTER_CLIENT_SECRET` - Your Client Secret from Twitter
3. Deploy for the changes to take effect

---

## 🗺️ Google My Business Integration Setup

### Step 1: Create Google Cloud Project

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/
   - Sign in with your Google account

2. **Create New Project** (or select existing)
   - Click "Select a project" → "New Project"
   - Name: "CheersAI GMB Integration"
   - Click "Create"

3. **Enable Required APIs**
   Navigate to "APIs & Services" → "Library" and enable:
   - ✅ **Google My Business API**
   - ✅ **Google Business Profile Performance API**
   - ✅ **Maps JavaScript API** (if using location features)

### Step 2: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" (unless you have Google Workspace)
3. Fill in the required information:
   - App name: "CheersAI"
   - User support email: Your email
   - App domain: `https://cheersai.orangejelly.co.uk`
   - Authorized domains: `cheersai.orangejelly.co.uk`
   - Developer contact: Your email

4. **Add Scopes**
   Click "Add or Remove Scopes" and add:
   - `https://www.googleapis.com/auth/business.manage`
   - `https://www.googleapis.com/auth/plus.business.manage` (if available)

5. **Add Test Users** (if in testing mode)
   - Add your email and any test accounts

### Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Choose "Web application"
4. Configure:
   - Name: "CheersAI Web Client"
   - Authorized JavaScript origins:
     ```
     https://cheersai.orangejelly.co.uk
     http://localhost:3000 (for testing)
     ```
   - Authorized redirect URIs:
     ```
     https://cheersai.orangejelly.co.uk/api/auth/google-my-business/callback
     http://localhost:3000/api/auth/google-my-business/callback (for testing)
     ```

5. Click "Create" and save:
   - **Client ID**
   - **Client Secret**

### Step 4: Add GMB Environment Variables

Add these to your `.env.local` file:

```env
# Google My Business
GOOGLE_MY_BUSINESS_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_MY_BUSINESS_CLIENT_SECRET=your_client_secret_here
```

### Step 5: Add to Vercel Environment Variables

1. Go to: https://vercel.com/your-team/cheersai/settings/environment-variables
2. Add both variables:
   - `GOOGLE_MY_BUSINESS_CLIENT_ID` - Your Client ID from Google
   - `GOOGLE_MY_BUSINESS_CLIENT_SECRET` - Your Client Secret from Google
3. Deploy for the changes to take effect

---

## 🧪 Testing the Integrations

### Test Twitter/X Connection:
1. Go to: https://cheersai.orangejelly.co.uk/settings/connections
2. Click "Connect" next to Twitter/X
3. Authorize the app on Twitter
4. Should redirect back with success

### Test Google My Business Connection:
1. Go to: https://cheersai.orangejelly.co.uk/settings/connections
2. Click "Connect" next to Google My Business
3. Sign in with Google account that manages GMB listings
4. Grant permissions
5. Should see your business locations

---

## 🔍 Troubleshooting

### Twitter/X Issues:

**"Callback URL mismatch"**
- Ensure callback URL in Twitter app matches exactly:
  `https://cheersai.orangejelly.co.uk/api/auth/twitter/callback`
- No trailing slashes!

**"Invalid client"**
- Check that both TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET are set
- Verify they match your Twitter app credentials

### Google My Business Issues:

**"Access blocked: This app's request is invalid"**
- Check that redirect URI matches exactly in Google Console
- Ensure OAuth consent screen is configured

**"Scope not authorized"**
- Make sure Google My Business API is enabled
- Check that scopes are added to OAuth consent screen

**"No business locations found"**
- Ensure the Google account has admin access to GMB listings
- Check that businesses are verified in Google My Business

---

## 📝 Required Information Checklist

### For Twitter/X:
- [ ] Twitter Developer Account
- [ ] Twitter App created
- [ ] Client ID obtained
- [ ] Client Secret obtained
- [ ] Callback URL configured
- [ ] Environment variables set

### For Google My Business:
- [ ] Google Cloud Project created
- [ ] GMB API enabled
- [ ] OAuth consent screen configured
- [ ] OAuth 2.0 credentials created
- [ ] Client ID obtained
- [ ] Client Secret obtained
- [ ] Redirect URIs configured
- [ ] Environment variables set

---

## 🚀 Quick Setup Summary

### Twitter/X Environment Variables:
```env
TWITTER_CLIENT_ID=AbCdEfGhIjKlMnOpQrStUv
TWITTER_CLIENT_SECRET=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789
```

### GMB Environment Variables:
```env
GOOGLE_MY_BUSINESS_CLIENT_ID=123456789-abcdefgh.apps.googleusercontent.com
GOOGLE_MY_BUSINESS_CLIENT_SECRET=GOCSPX-aBcDeFgHiJkLmNoPqRsTuVwXyZ
```

### Callback URLs to Configure:

**Twitter/X:**
```
https://cheersai.orangejelly.co.uk/api/auth/twitter/callback
```

**Google My Business:**
```
https://cheersai.orangejelly.co.uk/api/auth/google-my-business/callback
```

---

## 🎯 Next Steps

1. **Get credentials** from Twitter and Google
2. **Add to .env.local** for local testing
3. **Add to Vercel** environment variables
4. **Test connections** on the live site
5. **Monitor logs** for any OAuth errors

Once configured, users will be able to:
- Connect multiple Twitter/X accounts
- Connect Google My Business locations
- Post to all platforms from one dashboard
- Schedule posts across all channels

---

*Need help? Check the OAuth callback routes in `/app/api/auth/twitter/` and `/app/api/auth/google-my-business/` for implementation details.*