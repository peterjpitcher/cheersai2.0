'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { contentBriefSchema } from '@/features/create/schemas/content-schemas';
import type { ContentItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a snake_case content_items DB row to camelCase ContentItem.
 */
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
    aiGenerationParams: (row.ai_generation_params as Record<string, unknown>) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ---------------------------------------------------------------------------
// createDraft
// ---------------------------------------------------------------------------

/**
 * Create a new content draft from a content brief.
 * Validates input with contentBriefSchema, inserts into content_items.
 */
export async function createDraft(
  formData: unknown,
): Promise<{ success?: boolean; error?: string; id?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const parsed = contentBriefSchema.safeParse(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }

    const brief = parsed.data;

    // Build the DB row from the parsed brief
    const row: Record<string, unknown> = {
      account_id: accountId,
      content_type: brief.contentType,
      status: 'draft',
      title: brief.title,
      body_draft: brief, // store the full parsed brief as JSONB
    };

    // Type-specific fields
    if (brief.contentType === 'event') {
      row.event_date = brief.eventDate;
      row.event_end_date = brief.eventEndDate ?? null;
    }
    if (brief.contentType === 'promotion') {
      row.coupon_code = brief.couponCode ?? null;
    }
    if (brief.contentType === 'weekly_recurring') {
      row.recurring_day_of_week = brief.dayOfWeek;
      row.auto_confirm = true; // weekly recurring auto-publishes once approved
    }
    if (brief.contentType === 'instant_post' && brief.publishMode === 'schedule' && brief.scheduledFor) {
      row.scheduled_at = brief.scheduledFor;
    }

    const { data, error } = await supabase
      .from('content_items')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      return { error: error.message };
    }

    revalidatePath('/dashboard/create');

    return { success: true, id: (data as { id: string }).id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// saveDraft
// ---------------------------------------------------------------------------

/**
 * Update a draft's body_draft JSONB field (auto-save from wizard).
 * Only updates drafts owned by the current user's account.
 */
export async function saveDraft(
  contentId: string,
  draftState: unknown,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { error } = await supabase
      .from('content_items')
      .update({
        body_draft: draftState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contentId)
      .eq('account_id', accountId);

    if (error) {
      return { error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getDraft
// ---------------------------------------------------------------------------

/**
 * Retrieve a single content item by ID.
 * RLS ensures only the owner's account can access it.
 */
export async function getDraft(
  contentId: string,
): Promise<{ data?: ContentItem; error?: string }> {
  try {
    const { supabase } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', contentId)
      .single();

    if (error) {
      return { error: error.message };
    }

    return { data: mapContentItem(data as Record<string, unknown>) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// listDrafts
// ---------------------------------------------------------------------------

/**
 * List all draft content items for the current account.
 * Ordered by most recently updated, limited to 50.
 */
export async function listDrafts(): Promise<{
  data?: ContentItem[];
  error?: string;
}> {
  try {
    const { supabase } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      return { error: error.message };
    }

    const items = (data as Record<string, unknown>[]).map(mapContentItem);
    return { data: items };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// deleteDraft
// ---------------------------------------------------------------------------

/**
 * Delete a content item, but only if it has status 'draft'.
 * Account scoping is enforced via the accountId check.
 */
export async function deleteDraft(
  contentId: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { error } = await supabase
      .from('content_items')
      .delete()
      .eq('id', contentId)
      .eq('account_id', accountId)
      .eq('status', 'draft');

    if (error) {
      return { error: error.message };
    }

    revalidatePath('/dashboard/create');

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
