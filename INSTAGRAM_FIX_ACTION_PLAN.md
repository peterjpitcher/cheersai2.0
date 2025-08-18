# Instagram Integration Fix - Action Plan

Based on senior developer review confirming our analysis. Instagram Basic Display API is dead (Dec 4, 2024). We must use Facebook OAuth + Instagram Graph API.

## Immediate Actions Required

### 1. ❌ DELETE These Files
```bash
# Remove Instagram-specific OAuth implementation
rm app/api/auth/callback/instagram-business/route.ts
rm app/api/social/connect/instagram/route.ts  
rm components/social/instagram-connect-button.tsx
```

### 2. 🔧 UPDATE Environment Variables

#### Remove from `.env.local` and Vercel:
```env
INSTAGRAM_APP_ID=1138649858083556  # DELETE
INSTAGRAM_APP_SECRET=554404bd201993ac8f7d055f33d4a530  # DELETE
INSTAGRAM_VERIFY_TOKEN=9011c0ebf44ea49ea2e4674e62fbfa87  # DELETE
```

#### Keep only Facebook credentials:
```env
NEXT_PUBLIC_FACEBOOK_APP_ID=1001401138674450
FACEBOOK_APP_SECRET=089a1b973dab96f26e4cc6d053637d8a  # ROTATE THIS - IT'S EXPOSED
```

### 3. 📝 Facebook Developer Console Settings

Go to: https://developers.facebook.com/apps/1001401138674450

#### Add Products:
1. Facebook Login (standard, not "for Business")
2. Instagram Graph API

#### Configure Facebook Login:
- Valid OAuth Redirect URIs: `https://cheersai.orangejelly.co.uk/api/social/callback`
- Client OAuth Login: ON
- Web OAuth Login: ON
- Enforce HTTPS: ON

### 4. 🚀 Implementation Files to Create/Update

#### `/app/api/social/connect/route.ts` - UPDATE
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

const FB_VERSION = "v23.0";
const FB_DIALOG = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { platform } = await request.json();
    
    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    const state = Buffer.from(JSON.stringify({
      tenant_id: userData.tenant_id,
      user_id: user.id,
      platform,
    })).toString("base64");

    let authUrl = "";
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/social/callback`;

    switch (platform) {
      case "facebook":
      case "instagram_business":  // BOTH use Facebook OAuth now
        const scopes = [
          "email",
          "public_profile",
          "pages_show_list",
          "pages_read_engagement",
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_comments",
          "instagram_manage_insights",
        ].join(",");
        
        authUrl = `${FB_DIALOG}?` +
          `client_id=${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}&` +
          `redirect_uri=${encodeURIComponent(redirectUri)}&` +
          `response_type=code&` +
          `state=${state}&` +
          `scope=${scopes}`;
        break;

      // ... other platforms
    }

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("Social connect error:", error);
    return NextResponse.json(
      { error: "Failed to initiate connection" },
      { status: 500 }
    );
  }
}
```

#### `/app/api/social/callback/route.ts` - UPDATE
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FB_VERSION = "v23.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    if (error) {
      console.error("OAuth error:", error);
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=${encodeURIComponent(error)}`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=invalid_request`
      );
    }

    // Decode state
    const stateData = JSON.parse(Buffer.from(state, "base64").toString());
    const { tenant_id, platform } = stateData;

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/social/callback`;
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID!;
    const appSecret = process.env.FACEBOOK_APP_SECRET!;

    // Step 1: Get short-lived user token
    const tokenUrl = `${FB_GRAPH}/oauth/access_token?` +
      `client_id=${appId}&` +
      `client_secret=${appSecret}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `code=${code}`;

    const tokenResponse = await fetch(tokenUrl);
    const shortToken = await tokenResponse.json();

    if (!shortToken.access_token) {
      console.error("Failed to get access token:", shortToken);
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=token_failed`
      );
    }

    // Step 2: Exchange for long-lived token (~60 days)
    const longTokenUrl = `${FB_GRAPH}/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${appId}&` +
      `client_secret=${appSecret}&` +
      `fb_exchange_token=${shortToken.access_token}`;

    const longTokenResponse = await fetch(longTokenUrl);
    const longToken = await longTokenResponse.json();

    // Step 3: Get user's Facebook Pages
    const pagesResponse = await fetch(
      `${FB_GRAPH}/me/accounts?access_token=${longToken.access_token}`
    );
    const pagesData = await pagesResponse.json();

    if (!pagesData.data || pagesData.data.length === 0) {
      return NextResponse.redirect(
        `${baseUrl}/settings/connections?error=no_pages`
      );
    }

    const supabase = await createClient();
    const connections = [];

    // Step 4: Process each page
    for (const page of pagesData.data) {
      // Store Facebook page connection
      if (platform === "facebook") {
        connections.push({
          tenant_id,
          platform: "facebook",
          account_id: page.id,
          account_name: page.name,
          access_token: page.access_token,
          is_active: true,
        });
      }

      // Check for Instagram Business Account
      const pageInfoResponse = await fetch(
        `${FB_GRAPH}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
      );
      const pageInfo = await pageInfoResponse.json();
      
      if (pageInfo.instagram_business_account) {
        const igUserId = pageInfo.instagram_business_account.id;
        
        // Get Instagram username
        const igProfileResponse = await fetch(
          `${FB_GRAPH}/${igUserId}?fields=username,profile_picture_url&access_token=${page.access_token}`
        );
        const igProfile = await igProfileResponse.json();
        
        connections.push({
          tenant_id,
          platform: "instagram_business",
          account_id: igUserId,
          account_name: igProfile.username || "Instagram Business",
          access_token: page.access_token,  // Use PAGE token for IG
          page_id: page.id,
          page_name: page.name,
          metadata: {
            profile_picture_url: igProfile.profile_picture_url,
          },
          is_active: true,
        });
      }
    }

    // Step 5: Store all connections
    if (connections.length > 0) {
      const { error: dbError } = await supabase
        .from("social_connections")
        .upsert(connections, {
          onConflict: "tenant_id,platform,account_id",
        });

      if (dbError) {
        console.error("Failed to store connections:", dbError);
        return NextResponse.redirect(
          `${baseUrl}/settings/connections?error=storage_failed`
        );
      }
    }

    return NextResponse.redirect(
      `${baseUrl}/settings/connections?success=true`
    );
  } catch (error) {
    console.error("Callback error:", error);
    return NextResponse.redirect(
      `${baseUrl}/settings/connections?error=callback_failed`
    );
  }
}
```

### 5. 🗄️ Database Migration

Create: `/supabase/migrations/[timestamp]_fix_instagram_connections.sql`
```sql
-- Add fields for proper Instagram storage
ALTER TABLE social_connections 
ADD COLUMN IF NOT EXISTS page_id TEXT,
ADD COLUMN IF NOT EXISTS page_name TEXT,
ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Update any existing Instagram connections to mark as needing reconnection
UPDATE social_connections 
SET is_active = false,
    updated_at = NOW()
WHERE platform = 'instagram_business';
```

### 6. 🔒 Security Actions

1. **ROTATE FACEBOOK APP SECRET** - It's exposed in the docs
   - Go to: https://developers.facebook.com/apps/1001401138674450/settings/basic/
   - Click "Reset" next to App Secret
   - Update in Vercel environment variables

2. **Remove hardcoded secrets** from all files
3. **Ensure** `FACEBOOK_APP_SECRET` is only in server-side env

### 7. 📊 Update Instagram API Calls

In `/lib/social/instagram.ts`:
```typescript
// Publishing to Instagram
export async function publishToInstagram(
  igUserId: string,
  pageAccessToken: string,
  imageUrl: string,
  caption: string
) {
  const FB_VERSION = "v23.0";
  
  // Step 1: Create media container
  const createResponse = await fetch(
    `https://graph.facebook.com/${FB_VERSION}/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption,
        access_token: pageAccessToken,
      }),
    }
  );
  
  const { id } = await createResponse.json();
  
  // Step 2: Publish the container
  const publishResponse = await fetch(
    `https://graph.facebook.com/${FB_VERSION}/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: id,
        access_token: pageAccessToken,
      }),
    }
  );
  
  return publishResponse.json();
}
```

## Testing Checklist

### Local Testing
- [ ] Remove all Instagram env variables
- [ ] Update Facebook OAuth URLs to v23.0
- [ ] Test connection flow with Facebook test user
- [ ] Verify Instagram accounts are discovered from Pages
- [ ] Check Page access tokens are stored

### Production Testing  
- [ ] Deploy environment variable changes
- [ ] Add yourself as Facebook App Admin
- [ ] Connect your own Instagram Business account
- [ ] Verify posting works
- [ ] Check token expiry handling

## Timeline

### Day 1 (Immediate)
- Delete broken Instagram OAuth files
- Update environment variables
- Configure Facebook app settings
- Deploy security fixes

### Day 2
- Implement new OAuth flow
- Update callback handler
- Test with dev accounts

### Day 3
- Production deployment
- User testing
- Monitor for errors

### Day 4-5
- Add token refresh mechanism
- Implement reconnection UI
- Documentation updates

## Success Metrics

- [ ] No more "Error validating application" errors
- [ ] Users can connect Instagram via Facebook OAuth
- [ ] Instagram posts publish successfully
- [ ] Tokens properly stored with expiry dates
- [ ] Security audit passes (no exposed secrets)

## Notes

- Graph API v23.0 is current until May 29, 2025
- Long-lived tokens expire after ~60 days
- Page tokens derived from long-lived user tokens
- Must use Page access token for Instagram API calls
- Facebook App Review required for non-admin users

---

*This plan incorporates the senior developer's review and provides concrete implementation steps.*