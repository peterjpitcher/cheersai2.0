import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = await createClient();

    // Check if 2FA is already enabled
    const { data: existing2FA } = await supabase
      .from('two_factor_auth')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .single();

    if (existing2FA) {
      return NextResponse.json(
        { error: 'Two-factor authentication is already enabled' },
        { status: 400 }
      );
    }

    // Generate a secret
    const secret = speakeasy.generateSecret({
      name: `CheersAI (${user.email})`,
      issuer: 'CheersAI',
      length: 32,
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    // Store the secret temporarily (user needs to verify with a code first)
    const { error: storeError } = await supabase
      .from('two_factor_auth')
      .upsert({
        user_id: user.id,
        secret: secret.base32,
        backup_codes: generateBackupCodes(),
        is_enabled: false,
        is_verified: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (storeError) {
      console.error('Error storing 2FA secret:', storeError);
      return NextResponse.json(
        { error: 'Failed to set up two-factor authentication' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      qrCode: qrCodeUrl,
      secret: secret.base32,
      backupCodes: generateBackupCodes(),
      message: 'Please scan the QR code with your authenticator app and verify with a code',
    });
  } catch (error) {
    console.error('Error setting up 2FA:', error);
    return NextResponse.json(
      { error: 'Failed to set up two-factor authentication' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Verification code is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get the stored secret
    const { data: twoFactorData, error: fetchError } = await supabase
      .from('two_factor_auth')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (fetchError || !twoFactorData) {
      return NextResponse.json(
        { error: 'Two-factor authentication setup not found' },
        { status: 404 }
      );
    }

    // Verify the code
    const verified = speakeasy.totp.verify({
      secret: twoFactorData.secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!verified) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 400 }
      );
    }

    // Enable 2FA
    const { error: updateError } = await supabase
      .from('two_factor_auth')
      .update({
        is_enabled: true,
        is_verified: true,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error enabling 2FA:', updateError);
      return NextResponse.json(
        { error: 'Failed to enable two-factor authentication' },
        { status: 500 }
      );
    }

    // Update user metadata
    await supabase.auth.updateUser({
      data: { two_factor_enabled: true },
    });

    return NextResponse.json({
      success: true,
      message: 'Two-factor authentication has been enabled successfully',
      backupCodes: twoFactorData.backup_codes,
    });
  } catch (error) {
    console.error('Error verifying 2FA setup:', error);
    return NextResponse.json(
      { error: 'Failed to verify two-factor authentication' },
      { status: 500 }
    );
  }
}

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    codes.push(code);
  }
  return codes;
}