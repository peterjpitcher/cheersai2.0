import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deletes self-serve logins that never became a venue (tasks/SPEC-self-serve-
 * signup.md §4.10, decision P6: never confirmed 7 days after the last request,
 * or confirmed more than 30 days ago). public.run_data_retention lists them
 * under "self_serve_logins" (at most 100 a run); the daily data-retention cron
 * deletes each through the Auth admin API, as offboarding does, which also
 * removes its user_auth_snapshot row (trigger) and clears the sign-up row's
 * user_id (foreign key, on delete set null).
 */

export interface SelfServeLoginList {
  due: number;
  userIds: string[];
}

export interface SelfServeLoginCleanup {
  due: number;
  deleted: number;
  /** Became a venue or a member between the list and the delete: left alone. */
  skipped: number;
  failed: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The "self_serve_logins" part of run_data_retention's result. `undefined`
 * when it is absent (the function predates migration 20260928170000), `null`
 * when it is there but malformed.
 */
export function parseSelfServeLoginList(value: unknown): SelfServeLoginList | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') return null;
  const { due, user_ids: userIds } = value as { due?: unknown; user_ids?: unknown };
  if (typeof due !== 'number' || !Array.isArray(userIds)) return null;
  if (!userIds.every((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))) return null;
  return { due, userIds };
}

type Logger = { warn: (message: string, context?: Record<string, unknown>) => void };

/**
 * Deletes each listed login, one at a time. Just before each delete it checks
 * again that the login still has no venue and no membership, so a person who
 * created their venue after the list was made keeps their login. Reports
 * counts only; failures are logged with the user id (never the email).
 */
export async function deleteSelfServeLogins(
  service: SupabaseClient,
  list: SelfServeLoginList,
  logger: Logger,
): Promise<SelfServeLoginCleanup> {
  const result: SelfServeLoginCleanup = { due: list.due, deleted: 0, skipped: 0, failed: 0 };

  for (const userId of list.userIds) {
    const { data: signup, error: signupError } = await service
      .from('self_serve_signups')
      .select('account_id, venue_created_at')
      .eq('user_id', userId)
      .maybeSingle<{ account_id: string | null; venue_created_at: string | null }>();
    if (signupError) {
      logger.warn('self-serve login clean-up: could not re-check the sign-up row', { userId, error: signupError.message });
      result.failed += 1;
      continue;
    }
    if (!signup || signup.account_id || signup.venue_created_at) {
      result.skipped += 1;
      continue;
    }

    const { count, error: memberError } = await service
      .from('account_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (memberError) {
      logger.warn('self-serve login clean-up: could not re-check memberships', { userId, error: memberError.message });
      result.failed += 1;
      continue;
    }
    if ((count ?? 0) > 0) {
      result.skipped += 1;
      continue;
    }

    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) {
      logger.warn('self-serve login clean-up: deleteUser failed', { userId, error: error.message });
      result.failed += 1;
      continue;
    }
    result.deleted += 1;
  }

  return result;
}
