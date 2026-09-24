import { FEATURE_LABELS, hasFeature, type BrandFeature } from '@/lib/auth/brand-features';
import { requireAuthContext } from '@/lib/auth/server';
import type { AuthContext } from '@/lib/auth/types';

/**
 * Server-side enforcement of the per-brand feature switches.
 *
 * Paid ads, tournaments and the management-app import are built around The
 * Anchor, so they are off for every other brand until a super-admin switches
 * them on. There is deliberately no super-admin bypass: a super-admin viewing
 * a customer's brand sees exactly what that customer sees.
 */
export { FEATURE_LABELS, hasFeature, type BrandFeature };

export class FeatureUnavailableError extends Error {
  constructor(public readonly feature: BrandFeature) {
    super(`This brand doesn't have ${FEATURE_LABELS[feature].toLowerCase()} switched on.`);
    this.name = 'FeatureUnavailableError';
  }
}

/**
 * requireAuthContext() plus a check that the active brand has `feature` on.
 * Throws FeatureUnavailableError (fail closed) when it is off, so a guarded
 * server action or route can never run for a brand without the feature.
 */
export async function requireFeatureContext(feature: BrandFeature): Promise<AuthContext> {
  const ctx = await requireAuthContext();
  if (!hasFeature(ctx, feature)) {
    throw new FeatureUnavailableError(feature);
  }
  return ctx;
}
