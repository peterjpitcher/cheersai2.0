/**
 * One run of the google-posts cron (tasks/SPEC-gbp-posting-reintroduction.md,
 * decision D12). Server only.
 *
 * For each brand with the switch on and an active Google connection, inside a
 * strict time budget:
 *   a. create Google versions for new Facebook feed posts (D8),
 *   b. send the versions that are due,
 *   c. check Google's moderation state of versions already sent.
 * Every step catches its own failure, so one brand's or one row's problem
 * never stops the others. With no enabled, connected brand the run reads two
 * small tables and calls nothing outside the database.
 */

import type { GooglePostsDeps } from "@/lib/google-posts/deps";
import { listGoogleBrands } from "@/lib/google-posts/brands";
import { createVersionsForNewContent } from "@/lib/google-posts/create";
import { checkSentVersions, emptyModerationSummary, type ModerationSummary } from "@/lib/google-posts/moderation";
import { createTokenSource, emptySendSummary, sendDueVersions, type SendSummary } from "@/lib/google-posts/send";
import { createLogger } from "@/lib/logging";

const logger = createLogger("google-posts");

/** Logs a failed step by its message only (never a token, a signed URL or post text). */
function stepFailed(step: string, accountId: string, error: unknown): void {
  logger.error(`Google ${step} step failed for a brand`, new Error(error instanceof Error ? error.message : "unknown error"), {
    accountId,
    step,
  });
}

/** The route's maximum duration is 60 seconds; nothing new starts after 50. */
export const RUN_BUDGET_MS = 50_000;
/** Management app calls may start only in the first 15 seconds, so sending keeps most of the run. */
export const CREATE_PHASE_MS = 15_000;

export interface GooglePostsRunSummary {
  brands: number;
  created: number;
  createdAlready: number;
  createDeferred: number;
  send: SendSummary;
  moderation: ModerationSummary;
  /** Steps that failed outright (one brand's create, send or check). */
  stepFailures: number;
  /** True when the time budget stopped the run before every brand was done. */
  outOfTime: boolean;
  durationMs: number;
}

export async function runGooglePostsCron(
  deps: GooglePostsDeps,
  { budgetMs = RUN_BUDGET_MS }: { budgetMs?: number } = {},
): Promise<GooglePostsRunSummary> {
  const started = deps.now().getTime();
  const deadline = started + budgetMs;
  const summary: GooglePostsRunSummary = {
    brands: 0,
    created: 0,
    createdAlready: 0,
    createDeferred: 0,
    send: emptySendSummary(),
    moderation: emptyModerationSummary(),
    stepFailures: 0,
    outOfTime: false,
    durationMs: 0,
  };

  const brands = await listGoogleBrands(deps.db);
  summary.brands = brands.length;

  for (const brand of brands) {
    if (deps.now().getTime() >= deadline) {
      summary.outOfTime = true;
      break;
    }
    const tokens = createTokenSource(deps, brand.accountId);

    try {
      const created = await createVersionsForNewContent(deps, brand, {
        canCallManagement: () => deps.now().getTime() < started + Math.min(CREATE_PHASE_MS, budgetMs),
      });
      summary.created += created.created.length;
      summary.createdAlready += created.alreadyHad.length;
      summary.createDeferred += created.deferred;
      summary.stepFailures += created.failed.length;
      if (created.failed.length) stepFailed("create", brand.accountId, new Error(`${created.failed.length} version(s) could not be stored`));
    } catch (error) {
      summary.stepFailures += 1;
      stepFailed("create", brand.accountId, error);
    }

    try {
      await sendDueVersions(deps, brand, { deadline, tokens, summary: summary.send });
    } catch (error) {
      summary.stepFailures += 1;
      stepFailed("send", brand.accountId, error);
    }

    try {
      await checkSentVersions(deps, brand, { deadline, tokens, summary: summary.moderation });
    } catch (error) {
      summary.stepFailures += 1;
      stepFailed("check", brand.accountId, error);
    }
  }

  summary.durationMs = deps.now().getTime() - started;
  return summary;
}
