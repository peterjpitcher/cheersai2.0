import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deletes self-serve logins that never became a venue (tasks/SPEC-self-serve-
 * signup.md §4.10, decision P6: never confirmed 7 days after the last request,
 * or confirmed more than 30 days ago). public.run_data_retention lists them
 * under "self_serve_logins" (at most 100 a run), and the daily data-retention
 * cron hands each one to public.delete_stale_self_serve_login.
 *
 * The decision and the delete are one database transaction: that function
 * locks the login's sign-up row (select ... for update), applies the whole
 * rule again as it stands (no venue, no membership, not an admin, no open
 * team invitation, still past its cut-off) and, only if it still holds,
 * deletes the row in auth.users before the lock is released. A sign-up
 * request takes the same row lock (and venue creation in PR 6 must), so it
 * either finishes first, and the login is kept, or waits until the delete is
 * over. The delete removes the login's identities and sessions (cascade) and
 * its user_auth_snapshot row (trigger), and clears the sign-up row's user_id
 * (foreign key, on delete set null). It is done in SQL, not through the Auth
 * admin API, so Supabase writes no "user_deleted" security-log entry for it.
 */

export interface SelfServeLoginList {
  due: number;
  userIds: string[];
}

export interface SelfServeLoginCleanup {
  due: number;
  deleted: number;
  /** No longer past the rule when checked again under the lock: kept. */
  skipped: number;
  /** The delete failed (for example a login with audit_log rows): tried again next run. */
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
 * Hands each listed login, one at a time, to delete_stale_self_serve_login,
 * which answers deleted, kept (it no longer qualifies) or failed (for example
 * a login with audit_log rows). Never throws: a failure is logged with the
 * user id and the database's reason (never the email) and counted, and the
 * rest carry on. The caller alerts on failures; they must not fail the
 * retention run.
 */
export async function deleteSelfServeLogins(
  service: SupabaseClient,
  list: SelfServeLoginList,
  logger: Logger,
): Promise<SelfServeLoginCleanup> {
  const result: SelfServeLoginCleanup = { due: list.due, deleted: 0, skipped: 0, failed: 0 };

  for (const userId of list.userIds) {
    try {
      const { data, error } = await service.rpc('delete_stale_self_serve_login', { p_user_id: userId });
      if (error) {
        logger.warn('self-serve login clean-up: delete_stale_self_serve_login failed', { userId, error: error.message });
        result.failed += 1;
        continue;
      }
      const answer = (data ?? {}) as { status?: unknown; error?: unknown };
      if (answer.status === 'deleted') {
        result.deleted += 1;
      } else if (answer.status === 'kept') {
        result.skipped += 1;
      } else {
        logger.warn('self-serve login clean-up: the login could not be deleted', {
          userId,
          status: typeof answer.status === 'string' ? answer.status : 'unknown',
          error: typeof answer.error === 'string' ? answer.error : undefined,
        });
        result.failed += 1;
      }
    } catch (error) {
      logger.warn('self-serve login clean-up: unexpected error', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed += 1;
    }
  }

  return result;
}
