import { NextRequest } from "next/server";
import { createServiceRoleClient, type SupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/datetime";
import { sendEmail, type EmailTemplateName, type EmailTemplatePayloads } from "@/lib/email/resend";
import { z } from 'zod'
import { ok, badRequest, serverError, unauthorized } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'

export const runtime = 'nodejs'

const emailTemplateSchema = z.enum([
  'welcome',
  'passwordReset',
  'passwordChanged',
  'postPublished',
  'postFailed',
  'trialEnding',
  'scheduledReminder',
] as const)

type NotificationPayload = {
  type: EmailTemplateName
  recipientEmail: string
  data: EmailTemplatePayloads[EmailTemplateName] & { userId?: string; tenantId?: string }
}

async function deliverNotification(
  supabase: SupabaseServerClient,
  payload: NotificationPayload,
  reqLogger: ReturnType<typeof createRequestLogger>,
): Promise<{ success: true } | { success: false; error: unknown }> {
  const { type, recipientEmail, data } = payload
  const result = await sendEmail(recipientEmail, type, data as EmailTemplatePayloads[EmailTemplateName])

  if (!result.success) {
    reqLogger.event('error', {
      area: 'notifications',
      op: 'email.send',
      status: 'fail',
      msg: 'Email dispatch failed',
      meta: { type, error: result.error instanceof Error ? result.error.message : String(result.error) },
    })
    return { success: false, error: result.error }
  }

  await supabase
    .from('user_engagement')
    .insert({
      user_id: 'userId' in data ? (data.userId as string | undefined) : undefined,
      tenant_id: 'tenantId' in data ? (data.tenantId as string | undefined) : undefined,
      action: `email_${type}`,
      metadata: {
        recipient: recipientEmail,
        ...data,
      },
    })

  return { success: true }
}

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const secret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET
    if (!secret) {
      return serverError('Email notification secret not configured', undefined, request)
    }
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return unauthorized('Unauthorized email notification request', undefined, request)
    }

    const parsed = z.object({
      type: emailTemplateSchema,
      recipientEmail: z.string().email(),
      data: z.record(z.unknown())
    }).safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid email notification payload', parsed.error.format(), request)
    }
    const { type, recipientEmail, data } = parsed.data

    const payload: NotificationPayload = {
      type,
      recipientEmail,
      data: data as EmailTemplatePayloads[EmailTemplateName] & { userId?: string; tenantId?: string },
    }

    const supabase = await createServiceRoleClient();
    const delivery = await deliverNotification(supabase, payload, reqLogger)
    if (!delivery.success) {
      return serverError('Failed to send email notification', { error: delivery.error }, request)
    }

    reqLogger.event('info', {
      area: 'notifications',
      op: 'email.send',
      status: 'ok',
      msg: 'Email sent successfully',
      meta: { type },
    })

    return ok({ 
      success: true,
      message: "Email notification sent (or would be sent in production)"
    }, request);

  } catch (error) {
    reqLogger.error('Email notification handler failed', {
      area: 'notifications',
      op: 'email.send',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return serverError('Failed to send email notification', undefined, request)
  }
}

// Batch send notifications for scheduled posts
export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const secret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET
    if (!secret) {
      return serverError('Email notification secret not configured', undefined, request)
    }
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return unauthorized('Unauthorized email notification request', undefined, request)
    }

    const supabase = await createServiceRoleClient();

    // Get posts scheduled for the next hour
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1);
    
    type UpcomingPostRow = {
      scheduled_for: string
      campaign_posts: {
        content: string | null
        campaigns: {
          name: string | null
          tenant_id: string | null
        } | null
      } | null
      social_connections: {
        platform: string | null
        page_name: string | null
      } | null
    }

    const { data: upcomingPosts } = await supabase
      .from("publishing_queue")
      .select(`
        *,
        campaign_posts (
          content,
          campaigns (
            name,
            tenant_id
          )
        ),
        social_connections (
          platform,
          page_name
        )
      `)
      .eq("status", "pending")
      .gte("scheduled_for", new Date().toISOString())
      .lte("scheduled_for", nextHour.toISOString())
      .returns<UpcomingPostRow[]>();

    if (!upcomingPosts || upcomingPosts.length === 0) {
      return ok({ message: "No upcoming posts to notify about" }, request)
    }

    // Get user emails for notifications
    const notifications: NotificationPayload[] = [];
    
    for (const post of upcomingPosts) {
      const tenantId = post.campaign_posts?.campaigns?.tenant_id
      if (!tenantId) {
        continue
      }

      const { data: users } = await supabase
        .from("users")
        .select("email, id")
        .eq("tenant_id", tenantId);

      if (users && users.length > 0) {
        for (const user of users) {
          if (!user.email) continue
          const scheduledTime = post.scheduled_for ? formatDateTime(post.scheduled_for) : ''
          const previewContent = (post.campaign_posts?.content ?? '').slice(0, 100)
          notifications.push({
            type: 'scheduledReminder',
            recipientEmail: user.email,
            data: {
              userId: user.id,
              tenantId,
              campaignName: post.campaign_posts?.campaigns?.name ?? 'Campaign',
              platform: post.social_connections?.platform ?? 'unknown',
              scheduledTime,
              content: `${previewContent}${previewContent.length === 100 ? '…' : ''}`,
            },
          })
        }
      }
    }

    if (notifications.length === 0) {
      reqLogger.event('info', {
        area: 'notifications',
        op: 'email.batch',
        status: 'ok',
        msg: 'No eligible recipients for scheduled reminders',
      })
      return ok({ success: true, notificationsSent: 0 }, request)
    }

    let failures = 0
    for (const notification of notifications) {
      const delivery = await deliverNotification(supabase, notification, reqLogger)
      if (!delivery.success) {
        failures += 1
      }
    }

    reqLogger.event('info', {
      area: 'notifications',
      op: 'email.batch',
      status: failures === 0 ? 'ok' : 'fail',
      msg: 'Processed scheduled post reminders',
      meta: { count: notifications.length, failures },
    })

    return ok({ success: failures === 0, notificationsSent: notifications.length, failures }, request)

  } catch (error) {
    reqLogger.error('Batch notification handler failed', {
      area: 'notifications',
      op: 'email.batch',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return serverError('Failed to send batch notifications', undefined, request)
  }
}
