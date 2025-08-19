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
  
  console.log('=== GMB OAuth Connect Started ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Base URL:', baseUrl);
  
  try {
    const { user, tenantId } = await getUser();
    console.log('User auth status:', { hasUser: !!user, hasTenantId: !!tenantId });
    
    if (!user || !tenantId) {
      console.error('Unauthorized: Missing user or tenant');
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
    
    console.log('Generated auth URL successfully');
    console.log('Auth URL domain:', new URL(authUrl).hostname);
    console.log('Has client credentials:', {
      clientId: !!process.env.GOOGLE_MY_BUSINESS_CLIENT_ID,
      clientSecret: !!process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET
    });

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('=== GMB CONNECT ERROR ===');
    console.error('Error generating Google My Business auth URL:', error);
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    );
  }
}