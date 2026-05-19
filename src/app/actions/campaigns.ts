'use server';

/**
 * Recurring campaign lifecycle actions (06-05, D-14).
 * Pause, resume, and stop recurring campaigns from the campaign detail page.
 * All actions require auth, verify ownership, and log audit events.
 */

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { logPublishAuditEvent } from '@/lib/publishing/audit';

/**
 * Pause a recurring campaign.
 * Sets campaign status from 'scheduled' to 'paused'.
 * Materialisation and dispatch will skip paused campaigns.
 */
export async function pauseRecurringCampaign(
  campaignId: string,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, accountId } = await requireAuthContext();

  // Verify campaign belongs to this account and is in a pausable state
  const { data: campaign, error: fetchError } = await supabase
    .from('campaigns')
    .select('id, status, campaign_type')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single();

  if (fetchError || !campaign) {
    return { success: false, error: 'Campaign not found' };
  }

  if (campaign.status !== 'scheduled') {
    return { success: false, error: `Cannot pause a campaign with status '${campaign.status}'` };
  }

  const { error: updateError } = await supabase
    .from('campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('account_id', accountId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await logPublishAuditEvent({
    accountId,
    operationType: 'state_transition',
    resourceType: 'content_item',
    resourceId: campaignId,
    details: { action: 'pause_recurring', previousStatus: 'scheduled' },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath('/planner');
  return { success: true };
}

/**
 * Resume a paused recurring campaign.
 * Sets campaign status from 'paused' back to 'scheduled'.
 */
export async function resumeRecurringCampaign(
  campaignId: string,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, accountId } = await requireAuthContext();

  const { data: campaign, error: fetchError } = await supabase
    .from('campaigns')
    .select('id, status, campaign_type')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single();

  if (fetchError || !campaign) {
    return { success: false, error: 'Campaign not found' };
  }

  if (campaign.status !== 'paused') {
    return { success: false, error: `Cannot resume a campaign with status '${campaign.status}'` };
  }

  const { error: updateError } = await supabase
    .from('campaigns')
    .update({ status: 'scheduled', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('account_id', accountId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await logPublishAuditEvent({
    accountId,
    operationType: 'state_transition',
    resourceType: 'content_item',
    resourceId: campaignId,
    details: { action: 'resume_recurring', previousStatus: 'paused' },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath('/planner');
  return { success: true };
}

/**
 * Stop a recurring campaign permanently.
 * Sets campaign status to 'completed' and cancels all future scheduled content items.
 */
export async function stopRecurringCampaign(
  campaignId: string,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, accountId } = await requireAuthContext();

  const { data: campaign, error: fetchError } = await supabase
    .from('campaigns')
    .select('id, status, campaign_type')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single();

  if (fetchError || !campaign) {
    return { success: false, error: 'Campaign not found' };
  }

  if (campaign.status === 'completed') {
    return { success: false, error: 'Campaign is already completed' };
  }

  // Update campaign status to completed
  const { error: updateError } = await supabase
    .from('campaigns')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('account_id', accountId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Cancel all future scheduled content items for this campaign
  const now = new Date().toISOString();
  await supabase
    .from('content_items')
    .update({ status: 'draft', updated_at: now })
    .eq('campaign_id', campaignId)
    .eq('status', 'scheduled')
    .gt('scheduled_for', now);

  await logPublishAuditEvent({
    accountId,
    operationType: 'state_transition',
    resourceType: 'content_item',
    resourceId: campaignId,
    details: {
      action: 'stop_recurring',
      previousStatus: campaign.status,
      futureCancelled: true,
    },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath('/planner');
  return { success: true };
}
