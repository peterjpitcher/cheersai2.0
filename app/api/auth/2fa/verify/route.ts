import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as speakeasy from 'speakeasy';

export async function POST(request: NextRequest) {
  try {
    const { email, password, code } = await request.json();

    if (!email || !password || !code) {
      return NextResponse.json(
        { error: 'Email, password, and verification code are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // First, verify email and password
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Check if 2FA is enabled for this user
    const { data: twoFactorData, error: fetchError } = await supabase
      .from('two_factor_auth')
      .select('*')
      .eq('user_id', authData.user.id)
      .eq('is_enabled', true)
      .single();

    if (fetchError || !twoFactorData) {
      // 2FA not enabled, login successful
      return NextResponse.json({
        success: true,
        user: authData.user,
        session: authData.session,
      });
    }

    // Verify the 2FA code
    const verified = speakeasy.totp.verify({
      secret: twoFactorData.secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    // Check backup codes if TOTP fails
    let backupCodeUsed = false;
    if (!verified) {
      const backupCodes = twoFactorData.backup_codes || [];
      const codeIndex = backupCodes.indexOf(code.toUpperCase());
      
      if (codeIndex === -1) {
        // Sign out the user since 2FA failed
        await supabase.auth.signOut();
        
        return NextResponse.json(
          { error: 'Invalid verification code' },
          { status: 401 }
        );
      }

      // Remove used backup code
      backupCodeUsed = true;
      backupCodes.splice(codeIndex, 1);
      
      await supabase
        .from('two_factor_auth')
        .update({
          backup_codes: backupCodes,
          last_used_at: new Date().toISOString(),
        })
        .eq('user_id', authData.user.id);
    } else {
      // Update last used timestamp
      await supabase
        .from('two_factor_auth')
        .update({
          last_used_at: new Date().toISOString(),
        })
        .eq('user_id', authData.user.id);
    }

    // Log the successful 2FA authentication
    await supabase.from('auth_logs').insert({
      user_id: authData.user.id,
      event_type: '2fa_success',
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      user_agent: request.headers.get('user-agent'),
      backup_code_used: backupCodeUsed,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      user: authData.user,
      session: authData.session,
      backupCodeUsed,
      remainingBackupCodes: backupCodeUsed ? twoFactorData.backup_codes.length - 1 : undefined,
    });
  } catch (error) {
    console.error('Error verifying 2FA:', error);
    return NextResponse.json(
      { error: 'Failed to verify two-factor authentication' },
      { status: 500 }
    );
  }
}