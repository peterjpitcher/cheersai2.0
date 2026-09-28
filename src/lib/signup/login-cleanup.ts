import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deletes self-serve logins that never became a venue (tasks/SPEC-self-serve-
 * signup.md §4.10, decision P6: never confirmed 7 days after the last request,
 * or confirmed more than 30 days ago). public.run_data_retention lists them
 * under "self_serve_logins" (at most 100 a run); the daily data-retention cron
 * deletes each through the Auth admin API, as offboarding does, which also
 * removes its user_auth_snapshot row (trigger) and clears the sign-up row's
 * user_id (foreign key, on delete set null).
 *
 * The decision is the database's: just before each delete,
 * public.self_serve_login_deletable locks the login's sign-up row and applies
 * the whole rule again as it stands at that moment (no venue, no membership,
 * not an admin, no open team invitation, still past its cut-off). A login that
 * asked again, was invited, joined a brand or created a venue since the list
 * was made is left alone.
 */

export interface SelfServeLoginList {
  due: number;
  userIds: string[];
}

export interface SelfServeLoginCleanup {
  due: number;
  deleted: number;
  /** No longer past the rule when checked again: left alone. */
  skipped: number;
  /** The check or the delete failed (for example a login with audit_log rows): tried again next run. */
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
 * Deletes each listed login, one at a time, only when
 * self_serve_login_deletable says yes. Never throws: a failed check or delete
 * is logged with the user id (never the email) and counted, and the rest carry
 * on. The caller alerts on failures; they must not fail the retention run.
 */
export async function deleteSelfServeLogins(
  service: SupabaseClient,
  list: SelfServeLoginList,
  logger: Logger,
): Promise<SelfServeLoginCleanup> {
  const result: SelfServeLoginCleanup = { due: list.due, deleted: 0, skipped: 0, failed: 0 };

  for (const userId of list.userIds) {
    try {
      const { data: deletable, error: checkError } = await service.rpc('self_serve_login_deletable', { p_user_id: userId });
      if (checkError) {
        logger.warn('self-serve login clean-up: the deletion check failed', { userId, error: checkError.message });
        result.failed += 1;
        continue;
      }
      if (deletable !== true) {
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
