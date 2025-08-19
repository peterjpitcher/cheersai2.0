import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/auth';
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client';
import crypto from 'crypto';

// Force Node.js runtime for reliable Vercel logging
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Use the request URL to determine the base URL if env var is not set
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Generate state for CSRF protection
    const stateValue = crypto.randomBytes(32).toString('hex');
    
    // Encode tenant and user info with state for verification
    const stateData = Buffer.from(JSON.stringify({
      tenantId,
      userId: user.id,
      state: stateValue,
    })).toString('base64');

    const client = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${baseUrl}/api/auth/google-my-business/callback`,
    });

    const authUrl = await client.getAuthorizationUrl(stateData);

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('Error generating Google My Business auth URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    );
  }
}