/**
 * Content data access functions for server components and page.tsx files.
 *
 * These are NOT server actions -- they run in Server Components or layouts.
 * Uses the anon-key client (respects RLS) for account-scoped queries.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ContentItem, ContentStatus } from '@/types/content';

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
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ---------------------------------------------------------------------------
// getContentById
// ---------------------------------------------------------------------------

/**
 * Fetch a single content item by ID.
 * RLS enforces account scope -- no explicit account_id filter needed.
 */
export async function getContentById(
  id: string,
): Promise<ContentItem | null> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('id', id)
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
 * Fetch content items for the current account with optional filters.
 * RLS enforces account scope automatically via the anon-key client.
 *
 * @param options.status  - Filter by one or more statuses (default: all)
 * @param options.limit   - Max rows to return (default: 50)
 * @param options.offset  - Pagination offset (default: 0)
 */
export async function getContentByAccount(options?: {
  status?: ContentStatus[];
  limit?: number;
  offset?: number;
}): Promise<ContentItem[]> {
  const supabase = await createServerSupabaseClient();
  const { status, limit = 50, offset = 0 } = options ?? {};

  let query = supabase
    .from('content_items')
    .select('*')
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
 * Fetch content items scheduled within a date range (for planner calendar).
 * Only returns items that have a scheduled_at timestamp.
 *
 * @param startDate - ISO date string (inclusive)
 * @param endDate   - ISO date string (inclusive)
 */
export async function getContentForCalendar(
  startDate: string,
  endDate: string,
): Promise<ContentItem[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .gte('scheduled_at', startDate)
    .lte('scheduled_at', endDate)
    .order('scheduled_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as Record<string, unknown>[]).map(mapContentItem);
}
