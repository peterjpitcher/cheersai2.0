import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
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
      console.error("Password reset error:", error);
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
      console.error("Email notification error:", emailError);
    }

    return NextResponse.json({
      message: "If an account exists with this email, you will receive a password reset link."
    });
  } catch (error) {
    console.error("Password reset request error:", error);
    return NextResponse.json(
      { error: "Failed to process password reset request" },
      { status: 500 }
    );
  }
}

// Handle password update with token
export async function PUT(request: NextRequest) {
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
      console.error("Password update error:", error);
      return NextResponse.json(
        { error: "Failed to update password. The link may have expired." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: "Password updated successfully"
    });
  } catch (error) {
    console.error("Password update error:", error);
    return NextResponse.json(
      { error: "Failed to update password" },
      { status: 500 }
    );
  }
}
