# Twitter/X and Google My Business Integration Guide

## Table of Contents
- [Twitter/X Integration](#twitterx-integration)
  - [Developer Application](#developer-application)
  - [OAuth 2.0 Setup](#oauth-20-setup)
  - [API Implementation](#api-implementation)
- [Google My Business Integration](#google-my-business-integration)
  - [API Setup](#api-setup)
  - [OAuth Configuration](#oauth-configuration)
  - [Post Types](#post-types)

---

## Twitter/X Integration

### Developer Application

#### Prerequisites
- Twitter/X account
- Valid phone number for verification
- Clear use case description

#### Application Process

1. **Create Developer Account**
   - Visit https://developer.twitter.com
   - Apply for developer access
   - Select "Professional" tier for API v2 access

2. **Application Details**
   ```
   App Name: CheersAI Social Manager
   
   Description: 
   AI-powered social media management platform specifically designed 
   for UK hospitality businesses to automate content creation and 
   cross-platform publishing.
   
   Use Cases:
   - Automated content scheduling
   - Cross-platform publishing
   - Analytics tracking
   - User-generated content management
   ```

3. **Required Permissions**
   - Read and write access
   - Access to direct messages (optional)
   - Access to analytics

### OAuth 2.0 Setup

#### Configuration
```typescript
// lib/social/twitter.ts
const TWITTER_CONFIG = {
  authorizationURL: 'https://twitter.com/i/oauth2/authorize',
  tokenURL: 'https://api.twitter.com/2/oauth2/token',
  scopes: [
    'tweet.read',
    'tweet.write',
    'users.read',
    'offline.access'
  ]
};
```

#### PKCE Implementation
```typescript
async function generatePKCE() {
  const verifier = generateRandomString(128);
  const challenge = await sha256(verifier);
  return { verifier, challenge };
}
```

### API Implementation

#### Publishing Posts
```typescript
async function publishToTwitter(content: string, mediaIds?: string[]) {
  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: content,
      media: mediaIds ? { media_ids: mediaIds } : undefined
    })
  });
  
  return response.json();
}
```

---

## Google My Business Integration

### API Setup

#### Enable APIs
1. Visit [Google Cloud Console](https://console.cloud.google.com)
2. Create new project or select existing
3. Enable these APIs:
   - Google My Business API
   - Google Business Profile Performance API
   - Google OAuth 2.0

#### OAuth Credentials
```javascript
// Required OAuth Scopes
const GMB_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/businesscommunications'
];
```

### OAuth Configuration

#### Setup Flow
1. **Create OAuth Client**
   - Application type: Web application
   - Authorized redirect URIs: 
     - `https://yourdomain.com/api/auth/google-my-business/callback`
     - `http://localhost:3000/api/auth/google-my-business/callback` (dev)

2. **Implementation**
```typescript
// app/api/auth/google-my-business/connect/route.ts
export async function GET() {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  
  authUrl.searchParams.append('client_id', process.env.GOOGLE_CLIENT_ID!);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('scope', GMB_SCOPES.join(' '));
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', 'consent');
  
  return redirect(authUrl.toString());
}
```

### Post Types

#### Local Posts
```typescript
interface LocalPost {
  summary: string;
  languageCode: string;
  event?: {
    title: string;
    schedule: {
      startDate: string;
      startTime: string;
      endDate?: string;
      endTime?: string;
    };
  };
  offer?: {
    couponCode?: string;
    redeemOnlineUrl?: string;
    termsConditions?: string;
  };
  callToAction?: {
    actionType: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP';
    url: string;
  };
  media?: {
    mediaFormat: 'PHOTO' | 'VIDEO';
    sourceUrl: string;
  }[];
}
```

#### Publishing Implementation
```typescript
async function publishToGMB(
  accountId: string,
  locationId: string,
  post: LocalPost
) {
  const response = await fetch(
    `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(post)
    }
  );
  
  return response.json();
}
```

## Common Issues and Solutions

### Twitter/X Issues

#### Rate Limiting
- Free tier: 50 requests per 15 minutes
- Implement exponential backoff
- Cache user data when possible

#### Media Upload
- Max file size: 5MB for images, 512MB for videos
- Supported formats: JPG, PNG, GIF, MP4
- Upload media before creating tweet

### Google My Business Issues

#### Location Access
- User must be owner or manager of the location
- Verify location ownership in Google Business Profile

#### API Quotas
- Default: 5 QPS (queries per second)
- Request quota increase if needed
- Implement request batching

## Testing

### Twitter/X Test Mode
```typescript
// Use test environment
const TWITTER_TEST_URL = process.env.NODE_ENV === 'development' 
  ? 'https://api.twitter.com/2/tweets?dry_run=true'
  : 'https://api.twitter.com/2/tweets';
```

### GMB Test Locations
- Use test business locations in development
- Create sandbox Google Business Profile
- Test all post types before production

## Security Considerations

1. **Token Storage**
   - Encrypt tokens at rest
   - Use secure session management
   - Implement token refresh logic

2. **API Keys**
   - Never expose client secrets
   - Use environment variables
   - Rotate keys regularly

3. **User Permissions**
   - Request minimum required scopes
   - Allow users to revoke access
   - Implement granular permissions

## References

- [Twitter API v2 Documentation](https://developer.twitter.com/en/docs/twitter-api)
- [Google My Business API](https://developers.google.com/my-business)
- [OAuth 2.0 Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)

---

*Last Updated: January 2025*