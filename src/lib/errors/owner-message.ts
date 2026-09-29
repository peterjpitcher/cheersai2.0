/**
 * Owners never see technical error text (tasks/SPEC-plain-error-messages.md).
 *
 * These errors carry a message written for owners (the brand is on hold,
 * owners only, the feature is off), so a server action may return it as it
 * is. Anything else gets the caller's plain fallback, and the caller logs the
 * detail. Matched by name, not instanceof, so a test that mocks the module
 * defining one of them still works.
 */
const OWNER_READABLE_ERRORS = new Set(['EntitlementError', 'OwnerRequiredError', 'FeatureUnavailableError']);

export function ownerMessage(error: unknown, fallback: string): string {
  return error instanceof Error && OWNER_READABLE_ERRORS.has(error.name) ? error.message : fallback;
}
