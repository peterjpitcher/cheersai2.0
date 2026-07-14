/**
 * Auth-layer error taxonomy (multi-brand).
 *
 * Distinguishes an authentication failure (user not signed in -> treat as
 * logged out) from a DEPENDENCY failure (a membership/account/admin query
 * errored). Dependency failures must NOT masquerade as a logout: they are
 * thrown so an error boundary can show a retryable service error, rather than
 * silently redirecting an authenticated user to the login page.
 */
export class AuthDependencyError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AuthDependencyError';
    this.cause = cause;
  }
}
