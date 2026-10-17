/**
 * Which content and publish-job statuses mean a tournament post has already
 * gone out. The live publish worker (the publish-queue edge function) records
 * a sent post as content status 'posted' and job status 'succeeded'; the v2
 * handler records 'published'. Every check that protects sent posts from being
 * deleted or posted again must accept all three, so it lives in one place.
 */
export const PUBLISHED_CONTENT_STATUSES: ReadonlySet<string> = new Set(['published', 'posted', 'succeeded']);
export const PUBLISHED_JOB_STATUSES: readonly string[] = ['published', 'posted', 'succeeded'];

export function isPublishedContentStatus(status: unknown): boolean {
  return typeof status === 'string' && PUBLISHED_CONTENT_STATUSES.has(status);
}

export function isPublishedJobStatus(status: unknown): boolean {
  return typeof status === 'string' && PUBLISHED_JOB_STATUSES.includes(status);
}

/**
 * Statuses that mean a worker has claimed a post and may be sending it right
 * now: the live worker marks the job 'in_progress', the v2 handler 'publishing'.
 * Deleting such a post could leave a live post untracked or a send failing.
 */
export const IN_FLIGHT_STATUSES: readonly string[] = ['publishing', 'in_progress'];

export function isInFlightStatus(status: unknown): boolean {
  return typeof status === 'string' && IN_FLIGHT_STATUSES.includes(status);
}
