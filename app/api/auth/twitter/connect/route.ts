import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/auth';
import crypto from 'crypto';

// Twitter OAuth 2.0 configuration
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';

// OAuth 2.0 scopes for Twitter API v2
const SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'offline.access', // For refresh token
].join(' ');

export async function GET(request: NextRequest) {
  // Use the request URL to determine the base URL if env var is not set
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const TWITTER_REDIRECT_URI = `${baseUrl}/api/auth/twitter/callback`;
  
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Generate PKCE challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store code verifier and state in session (in production, use a proper session store)
    // For now, we'll encode it in the state parameter
    const stateData = Buffer.from(JSON.stringify({
      tenantId,
      userId: user.id,
      codeVerifier,
      state,
    })).toString('base64');

    // Build OAuth 2.0 authorization URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: TWITTER_CLIENT_ID,
      redirect_uri: TWITTER_REDIRECT_URI,
      scope: SCOPES,
      state: stateData,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Use x.com as per current Twitter/X documentation
    const authUrl = `https://x.com/i/oauth2/authorize?${params}`;

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('Error generating Twitter auth URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    );
  }
}