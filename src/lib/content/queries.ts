/**
 * Content data access functions for server components and page.tsx files.
 *
 * These are NOT server actions -- they run in Server Components or layouts.
 * Uses the anon-key client (respects RLS). Under multi-brand tenancy, RLS is a
 * membership CEILING (it authorises every brand the user belongs to), so these
 * reads MUST additionally scope to the caller's ACTIVE brand via an explicit
 * account_id filter -- otherwise a multi-brand user would see other brands'
 * content. Callers pass the verified active accountId from the auth context.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ContentItem, ContentStatus, Platform } from '@/types/content';

// ---------------------------------------------------------------------------
// Mapper: snake_case DB row -> camelCase ContentItem
// ---------------------------------------------------------------------------

function mapContentItem(row: Record<string, unknown>): ContentItem {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    contentType: row.content_type as ContentItem['contentType'],
    status: row.status as ContentItem['status'],
    title: (row.title as string) ?? null,
    bodyDraft: (row.body_draft as Record<string, unknown>) ?? null,
    campaignName: (row.campaign_name as string) ?? null,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : null,
    eventDate: (row.event_date as string) ?? null,
    eventEndDate: (row.event_end_date as string) ?? null,
    couponCode: (row.coupon_code as string) ?? null,
    recurringDayOfWeek: (row.recurring_day_of_week as number) ?? null,
    autoConfirm: (row.auto_confirm as boolean) ?? false,
    aiGenerationParams:
      (row.ai_generation_params as Record<string, unknown>) ?? null,
    thumbnailUrl: null,
    placement: row.placement === 'story' ? 'story' : 'feed',
    platform: isPlatform(row.platform) ? row.platform : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function isPlatform(value: unknown): value is Platform {
  return value === 'facebook' || value === 'instagram';
}

// ---------------------------------------------------------------------------
// getContentById
// ---------------------------------------------------------------------------

/**
 * Fetch a single content item by ID, scoped to the active brand.
 */
export async function getContentById(
  id: string,
  accountId: string,
): Promise<ContentItem | null> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('id', id)
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return null;
  }

  return mapContentItem(data as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// getContentByAccount
// ---------------------------------------------------------------------------

/**
 * Fetch content items for the active brand with optional filters.
 *
 * @param accountId        - The active brand id to scope to (required)
 * @param options.status  - Filter by one or more statuses (default: all)
 * @param options.limit   - Max rows to return (default: 50)
 * @param options.offset  - Pagination offset (default: 0)
 */
export async function getContentByAccount(
  accountId: string,
  options?: {
    status?: ContentStatus[];
    limit?: number;
    offset?: number;
  },
): Promise<ContentItem[]> {
  const supabase = await createServerSupabaseClient();
  const { status, limit = 50, offset = 0 } = options ?? {};

  let query = supabase
    .from('content_items')
    .select('*')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status.length > 0) {
    query = query.in('status', status);
  }

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return (data as Record<string, unknown>[]).map(mapContentItem);
}

// ---------------------------------------------------------------------------
// getContentForCalendar
// ---------------------------------------------------------------------------

/**
 * Fetch content items scheduled within a date range (for planner calendar),
 * scoped to the active brand. Only returns items with a scheduled_at timestamp.
 *
 * @param accountId - The active brand id to scope to (required)
 * @param startDate - ISO date string (inclusive)
 * @param endDate   - ISO date string (inclusive)
 */
export async function getContentForCalendar(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<ContentItem[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .gte('scheduled_at', startDate)
    .lte('scheduled_at', endDate)
    .order('scheduled_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as Record<string, unknown>[]).map(mapContentItem);
}
