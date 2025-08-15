import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import * as speakeasy from 'speakeasy';

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { password, code } = await request.json();

    if (!password || !code) {
      return NextResponse.json(
        { error: 'Password and verification code are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Verify password
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password,
    });

    if (authError) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }

    // Get 2FA data
    const { data: twoFactorData, error: fetchError } = await supabase
      .from('two_factor_auth')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .single();

    if (fetchError || !twoFactorData) {
      return NextResponse.json(
        { error: 'Two-factor authentication is not enabled' },
        { status: 400 }
      );
    }

    // Verify the 2FA code
    const verified = speakeasy.totp.verify({
      secret: twoFactorData.secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!verified) {
      // Check if it's a backup code
      const backupCodes = twoFactorData.backup_codes || [];
      const codeIndex = backupCodes.indexOf(code.toUpperCase());
      
      if (codeIndex === -1) {
        return NextResponse.json(
          { error: 'Invalid verification code' },
          { status: 401 }
        );
      }
    }

    // Disable 2FA
    const { error: updateError } = await supabase
      .from('two_factor_auth')
      .update({
        is_enabled: false,
        is_verified: false,
        disabled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error disabling 2FA:', updateError);
      return NextResponse.json(
        { error: 'Failed to disable two-factor authentication' },
        { status: 500 }
      );
    }

    // Update user metadata
    await supabase.auth.updateUser({
      data: { two_factor_enabled: false },
    });

    // Log the action
    await supabase.from('auth_logs').insert({
      user_id: user.id,
      event_type: '2fa_disabled',
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      user_agent: request.headers.get('user-agent'),
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: 'Two-factor authentication has been disabled',
    });
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    return NextResponse.json(
      { error: 'Failed to disable two-factor authentication' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = await createClient();

    // Get 2FA status
    const { data: twoFactorData } = await supabase
      .from('two_factor_auth')
      .select('is_enabled, is_verified, created_at, verified_at, last_used_at')
      .eq('user_id', user.id)
      .single();

    return NextResponse.json({
      enabled: twoFactorData?.is_enabled || false,
      verified: twoFactorData?.is_verified || false,
      createdAt: twoFactorData?.created_at,
      verifiedAt: twoFactorData?.verified_at,
      lastUsedAt: twoFactorData?.last_used_at,
    });
  } catch (error) {
    console.error('Error getting 2FA status:', error);
    return NextResponse.json(
      { error: 'Failed to get two-factor authentication status' },
      { status: 500 }
    );
  }
}