import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/auth';
import { GoogleMyBusinessClient } from '@/lib/social/google-my-business/client';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in a secure session or database
    // For now, we'll include it in the URL

    const client = new GoogleMyBusinessClient({
      clientId: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-my-business/callback`,
    });

    const authUrl = await client.getAuthorizationUrl(state);

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('Error generating Google My Business auth URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    );
  }
}