import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTierSupport } from "@/lib/stripe/config";
import { z } from 'zod'
import { createTicketSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, forbidden, serverError } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import type { Database } from '@/lib/types/database'

export const runtime = 'nodejs'

type TenantSupportInfo = Pick<Database['public']['Tables']['tenants']['Row'], 'subscription_tier'>

type UserSupportQuery = {
  tenant_id: string | null
  tenant: TenantSupportInfo | TenantSupportInfo[] | null
}

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const raw = await request.json();
    const parsed = z.object(createTicketSchema.shape).extend({
      support_channel: z.enum(['email', 'whatsapp', 'phone', 'community']),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    }).safeParse(raw)

    if (!parsed.success) {
      return badRequest('validation_error', 'Invalid ticket payload', parsed.error.format(), request)
    }
    const { subject, message, priority, support_channel } = parsed.data

    // Get user's tenant information
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id, tenant:tenants(subscription_tier)")
      .eq("id", user.id)
      .single<UserSupportQuery>();

    if (!userData || !userData.tenant_id) {
      return badRequest('tenant_missing', 'User tenant not found', undefined, request)
    }

    // Verify the subscription tier matches and user has access to the channel
    const tenantRow = Array.isArray(userData?.tenant) ? userData?.tenant[0] : userData?.tenant
    const actualTier = tenantRow?.subscription_tier ?? 'free'
    const supportTier = getTierSupport(actualTier);

    // Check if user has access to the selected support channel
    if (support_channel === 'email' && !supportTier.email) {
      return forbidden('Email support not available for your plan', undefined, request)
    }
    if (support_channel === 'whatsapp' && !supportTier.whatsapp) {
      return forbidden('WhatsApp support not available for your plan', undefined, request)
    }
    if (support_channel === 'phone' && !supportTier.phone) {
      return forbidden('Phone support not available for your plan', undefined, request)
    }

    // Gather request metadata
    const userAgent = request.headers.get('user-agent') || '';
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    
    const metadata = {
      user_agent: userAgent,
      ip_address: ip,
      submitted_at: new Date().toISOString(),
      browser_info: {
        platform: request.headers.get('sec-ch-ua-platform'),
        mobile: request.headers.get('sec-ch-ua-mobile'),
      }
    };

    // Create the support ticket
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        tenant_id: userData.tenant_id,
        user_id: user.id,
        subject: subject.substring(0, 200), // Ensure subject length limit
        message,
        priority,
        support_channel,
        subscription_tier: actualTier,
        metadata,
        status: 'open'
      })
      .select()
      .single();

    if (ticketError) {
      reqLogger.error('Error creating support ticket', {
        area: 'support',
        op: 'ticket.create',
        status: 'fail',
        error: ticketError,
        tenantId: userData.tenant_id,
        userId: user.id,
      })
      return serverError('Failed to create support ticket', ticketError, request)
    }

    // TODO: Here you would typically:
    // 1. Send notification email to support team
    // 2. Create ticket in your support system (Zendesk, Intercom, etc.)
    // 3. Send confirmation email to user
    // 4. For WhatsApp/Phone support, create appropriate notifications

    // For now, we'll just log the ticket creation
    reqLogger.info('Support ticket created', {
      area: 'support',
      op: 'ticket.create',
      status: 'ok',
      tenantId: userData.tenant_id,
      userId: user.id,
      meta: {
        ticketId: ticket.id,
        channel: support_channel,
        priority,
        tier: actualTier,
      }
    })

    return ok({
      success: true,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        priority: ticket.priority,
        support_channel: ticket.support_channel,
        status: ticket.status,
        created_at: ticket.created_at
      }
    }, request)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Unexpected error in support ticket POST', {
      area: 'support',
      op: 'ticket.create',
      status: 'fail',
      error: err,
    })
    logger.error('Support ticket POST failed', {
      area: 'support',
      op: 'ticket.create',
      status: 'fail',
      error: err,
    })
    return serverError('Internal server error', undefined, request)
  }
}

// GET endpoint to retrieve user's support tickets
export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get user's tenant information
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData || !userData.tenant_id) {
      return badRequest('tenant_missing', 'User tenant not found', undefined, request)
    }

    // Fetch user's support tickets
    const { data: tickets, error: ticketsError } = await supabase
      .from("support_tickets")
      .select(`
        id,
        subject,
        priority,
        status,
        support_channel,
        subscription_tier,
        created_at,
        updated_at,
        resolved_at
      `)
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (ticketsError) {
      reqLogger.error('Error fetching support tickets', {
        area: 'support',
        op: 'ticket.list',
        status: 'fail',
        error: ticketsError,
        tenantId: userData.tenant_id,
        userId: user.id,
      })
      return serverError('Failed to fetch support tickets', ticketsError, request)
    }

    return ok({ success: true, tickets: tickets || [] }, request)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Unexpected error in support ticket GET', {
      area: 'support',
      op: 'ticket.list',
      status: 'fail',
      error: err,
    })
    logger.error('Support ticket GET failed', {
      area: 'support',
      op: 'ticket.list',
      status: 'fail',
      error: err,
    })
    return serverError('Internal server error', undefined, request)
  }
}
