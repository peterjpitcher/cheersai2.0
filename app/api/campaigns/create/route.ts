import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from 'zod'
import { createCampaignSchema } from '@/lib/validation/schemas'
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/http'
import { createRequestLogger } from '@/lib/observability/logger'
import { safeLog } from '@/lib/scrub'

export const runtime = 'nodejs'

type TenantIdRow = { tenant_id: string | null }

const toIsoString = (value: unknown): string | undefined => {
  if (typeof value === 'string' || value instanceof Date) {
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return undefined
}

const clampString = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' ? value.slice(0, max) : undefined

const filterStrings = (value: unknown, predicate?: (input: string) => boolean): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && (!predicate || predicate(item)))
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const reqLogger = createRequestLogger(request as unknown as Request)
    reqLogger.apiRequest('POST', '/api/campaigns/create', { area: 'campaigns', op: 'create' })
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      reqLogger.warn('Unauthorized campaign create attempt')
      return unauthorized('Authentication required', undefined, request)
    }

    // Resolve user's tenant ID robustly (adopt membership if missing and persist)
    let tenantId: string | null = null
    const { data: userRow, error: userRowErr } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle<TenantIdRow>()

    if (userRowErr) {
      reqLogger.warn('Users row fetch error; attempting to create minimal profile', { userId: user.id, err: userRowErr.message })
    }
    if (!userRow) {
      // Create minimal users row if missing (idempotent)
      const { error: insErr } = await supabase.from('users').insert({ id: user.id, email: user.email }).select().maybeSingle()
      if (insErr) reqLogger.warn('Create users row failed (non-fatal)', { err: insErr.message })
    }

    tenantId = userRow?.tenant_id ?? null
    if (!tenantId) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id, role, created_at')
        .eq('user_id', user.id)
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (typeof membership?.tenant_id === 'string') {
        tenantId = membership.tenant_id
        // Persist onto users for RLS helper get_user_tenant_id()
        await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id)
      }
    }

    if (!tenantId) {
      reqLogger.warn('No tenant for user on campaign create', { userId: user.id })
      return notFound('No tenant found', undefined, request)
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    reqLogger.debug?.('Create campaign payload received', { tenantId, len: JSON.stringify(body)?.length })

    // Normalise incoming payload to be lenient with date formats and optional fields
    const ALLOWED_TIMINGS = new Set([
      'six_weeks',
      'five_weeks',
      'month_before',
      'three_weeks',
      'two_weeks',
      'two_days_before',
      'week_before',
      'day_before',
      'day_of',
    ])
    const ALLOWED_PLATFORMS = new Set(['facebook','instagram','linkedin','google_my_business'])

    // Helper to clamp string length safely
    const norm = {
      name: typeof body.name === 'string' ? body.name : '',
      // Clamp long briefs to validation limit before Zod checks
      description: clampString(body.description, 10000),
      campaign_type: typeof body.campaign_type === 'string' ? body.campaign_type : 'event',
      // Accept both date-only and datetime strings; coerce to ISO where provided
      startDate: toIsoString(body.startDate),
      endDate: toIsoString(body.endDate),
      event_date: toIsoString(body.event_date),
      hero_image_id: typeof body.hero_image_id === 'string' ? body.hero_image_id : null,
      selected_timings: filterStrings(body.selected_timings, value => ALLOWED_TIMINGS.has(value)),
      custom_dates: filterStrings(body.custom_dates)
        .map(toIsoString)
        .filter((date): date is string => typeof date === 'string'),
      platforms: filterStrings(body.platforms, value => ALLOWED_PLATFORMS.has(value)),
      status: typeof body.status === 'string' ? body.status : 'draft',
    }

    const parsed = z.object(createCampaignSchema.shape).safeParse(norm)
    if (!parsed.success) {
      const details = parsed.error.format()
      reqLogger.warn('Campaign validation failed', { details })
      return badRequest('validation_error', 'Invalid campaign payload', details, request)
    }
    const input = parsed.data
    reqLogger.info('Campaign payload normalised', {
      area: 'campaigns', op: 'create',
      hasEventDate: !!input.event_date,
      selectedTimingsCount: (input.selected_timings || []).length,
      customDatesCount: (input.custom_dates || []).length,
    })

    // Check subscription limits for campaign creation
    const { data: existingCampaigns } = await supabase
      .from('campaigns')
      .select('id')
      .eq('tenant_id', tenantId)
      .neq('status', 'completed');

    // Get subscription tier and limits
    const { data: tenant } = await supabase
      .from('tenants')
      .select('subscription_tier, subscription_status, total_campaigns_created')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      reqLogger.warn('Tenant record not found when creating campaign', { tenantId })
      return notFound('Tenant not found', undefined, request)
    }

    // Check trial limits first (10 campaigns total during trial)
    const isTrialing = tenant.subscription_status === 'trialing' || tenant.subscription_status === null;
    const campaignCount = tenant.total_campaigns_created || 0;
    
    if (isTrialing && campaignCount >= 10) {
      reqLogger.info('Trial limit reached on campaign create', { tenantId, campaignCount })
      return forbidden("You've reached the free trial limit of 10 campaigns. Please upgrade to continue creating campaigns.", { currentCount: campaignCount, limit: 10 }, request)
    }

    // Basic tier limits (can be moved to config) - monthly limits
    const campaignLimits: Record<string, number> = {
      'free': 10,
      'starter': 50,
      'professional': 200,
      'enterprise': 999999
    };

    const tierKey = tenant.subscription_tier ?? 'free';
    const limit = campaignLimits[tierKey] ?? 10;
    
    if (!isTrialing && existingCampaigns && existingCampaigns.length >= limit) {
      reqLogger.info('Plan campaign limit reached', { tenantId, limit, existing: existingCampaigns.length, tier: tenant.subscription_tier })
      return forbidden(`Campaign limit reached. Your ${tenant.subscription_tier} plan allows ${limit} active campaigns.`, { currentCount: existingCampaigns.length, limit }, request)
    }

    // Normalize dates and scheduling fields
    const eventDate = input.event_date || input.startDate || null
    const selectedTimings = Array.isArray(input.selected_timings) ? input.selected_timings : []
    const customDates = Array.isArray(input.custom_dates) ? input.custom_dates : []

    // Create the campaign - log the data being inserted for debugging
    const campaignData = {
      tenant_id: tenantId,
      name: input.name,
      campaign_type: input.campaign_type,
      event_date: eventDate,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      description: input.description || null,
      hero_image_id: input.hero_image_id || null,
      status: input.status || 'draft',
      selected_timings: selectedTimings,
      custom_dates: customDates,
      created_by: user.id,
    };
    
    reqLogger.info('Attempting to create campaign', { tenantId, name: campaignData.name, type: campaignData.campaign_type })

    // Optional: capture DB's view of tenant context for RLS debugging
    if (process.env.DEBUG_RLS === '1') {
      try {
        const [{ data: dbAuthTenant }, { data: memberships } ] = await Promise.all([
          // Exposed as RPC by Supabase for functions in public schema
          supabase.rpc('get_auth_tenant_id'),
          supabase.from('user_tenants').select('tenant_id, role').eq('user_id', user.id)
        ])
        reqLogger.info('RLS debug snapshot', {
          resolvedTenantId: tenantId,
          dbGetAuthTenantId: dbAuthTenant,
          membershipTenantIds: Array.isArray(memberships) ? memberships.map(m => m.tenant_id) : [],
          membershipRoles: Array.isArray(memberships) ? memberships.map(m => m.role) : []
        })
      } catch (error) {
        safeLog('RLS debug snapshot failed', error)
      }
    }

    // Ensure users.tenant_id matches our resolved tenantId for RLS check
    try {
      await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id)
    } catch {}

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert(campaignData)
      .select('id,name')
      .single();

    if (error || !campaign) {
      const message = error?.message ?? 'Unknown campaign creation failure'
      const details = error?.details ?? undefined
      safeLog('Campaign creation error:', error ?? 'Insert returned no campaign')
      return serverError('Failed to create campaign', { message, code: error?.code, details }, request)
    }

    // Increment total campaigns created for trial tracking
    if (isTrialing) {
      await supabase
        .from('tenants')
        .update({ 
          total_campaigns_created: campaignCount + 1 
        })
        .eq('id', tenantId);
      reqLogger.info('Incremented trial total_campaigns_created', { tenantId, newCount: campaignCount + 1 })
    }

    // Log activity
    try {
      await supabase
        .from('activity_logs')
        .insert({
          tenant_id: tenantId,
          user_id: user.id,
          action: 'campaign_created',
          details: {
            campaign_id: campaign.id,
            campaign_name: campaign.name
          }
        });
    } catch (error) {
      // Non-blocking: activity_logs may not exist in some environments
      safeLog('activity_logs insert skipped:', error)
    }

    // For compatibility with clients expecting top-level `campaign`, include it directly.
    reqLogger.apiResponse('POST', '/api/campaigns/create', 201, 0, { area: 'campaigns', op: 'create', status: 'ok', tenantId })
    reqLogger.apiResponse('POST', '/api/campaigns/create', 201, 0, { area: 'campaigns', op: 'create', status: 'ok', campaignId: campaign.id })
    return ok({ campaign }, request, { status: 201 })
  } catch (error) {
    safeLog('Campaign creation error (unhandled):', error)
    const err = error instanceof Error ? error : new Error(String(error))
    return serverError('An unexpected error occurred', { message: err.message }, request)
  }
}
