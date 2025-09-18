import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRequestLogger, logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const { email } = await request.json();
    
    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    
    // Generate password reset link
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
    });

    if (error) {
      reqLogger.warn('Password reset email request failed', {
        area: 'auth',
        op: 'reset-password.request-link',
        status: 'fail',
        error,
        meta: { email },
      })
      // Don't reveal if email exists or not for security
      return NextResponse.json({
        message: "If an account exists with this email, you will receive a password reset link."
      });
    }

    // Send email notification (will be implemented with Resend)
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "password_reset",
          recipientEmail: email,
          data: {
            resetUrl: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`
          }
        })
      });
    } catch (emailError) {
      const err = emailError instanceof Error ? emailError : new Error(String(emailError))
      reqLogger.error('Password reset notification failed', {
        area: 'auth',
        op: 'reset-password.notification',
        status: 'fail',
        error: err,
        meta: { email },
      })
      logger.error('Password reset notification failed', {
        area: 'auth',
        op: 'reset-password.notification',
        status: 'fail',
        error: err,
      })
    }

    return NextResponse.json({
      message: "If an account exists with this email, you will receive a password reset link."
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Password reset request error', {
      area: 'auth',
      op: 'reset-password.request',
      status: 'fail',
      error: err,
    })
    logger.error('Password reset request error', {
      area: 'auth',
      op: 'reset-password.request',
      status: 'fail',
      error: err,
    })
    return NextResponse.json(
      { error: "Failed to process password reset request" },
      { status: 500 }
    );
  }
}

// Handle password update with token
export async function PUT(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const { password, token } = await request.json();
    
    if (!password || !token) {
      return NextResponse.json(
        { error: "Password and token are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    
    // Update password using the token
    const { error } = await supabase.auth.updateUser({
      password: password
    });

    if (error) {
      reqLogger.warn('Password update failed', {
        area: 'auth',
        op: 'reset-password.update',
        status: 'fail',
        error,
      })
      return NextResponse.json(
        { error: "Failed to update password. The link may have expired." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: "Password updated successfully"
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Password update error', {
      area: 'auth',
      op: 'reset-password.update',
      status: 'fail',
      error: err,
    })
    logger.error('Password update error', {
      area: 'auth',
      op: 'reset-password.update',
      status: 'fail',
      error: err,
    })
    return NextResponse.json(
      { error: "Failed to update password" },
      { status: 500 }
    );
  }
}
