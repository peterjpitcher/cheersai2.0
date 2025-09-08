import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { changePasswordSchema } from '@/lib/validation/schemas'
import { badRequest, ok, unauthorized, serverError } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const body = await request.json();
    const { currentPassword, newPassword } = z.object(changePasswordSchema.shape).parse(body)

    // Verify current password by attempting to sign in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });

    if (signInError) {
      return badRequest('invalid_current_password', 'Current password is incorrect', undefined, request)
    }

    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      return badRequest('password_update_failed', updateError.message, undefined, request)
    }

    return ok({ success: true, message: "Password updated successfully" }, request)
  } catch (error) {
    console.error("Change password error:", error);
    return serverError('Failed to change password', undefined, request)
  }
}
