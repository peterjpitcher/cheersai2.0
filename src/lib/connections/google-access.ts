/**
 * The Google access rule (decision D10): Google is for the owner's own
 * profiles only, so every Google path checks the brand's googlePosts switch
 * on the server and fails closed. A missing brand or a missing switch is "off".
 */

interface FeatureHolder {
  features?: { googlePosts?: boolean } | null;
}

/** The ACTIVE brand has Google posting switched on. */
export function activeBrandHasGooglePosts(ctx: FeatureHolder): boolean {
  return ctx.features?.googlePosts === true;
}

/**
 * A NAMED brand has Google posting switched on. Used where the brand comes
 * from an oauth_states row (the brand that started the flow), which may not be
 * the brand selected now. A brand the caller cannot see is "off".
 */
export function brandHasGooglePosts(
  ctx: { brands?: Array<FeatureHolder & { accountId: string }> | null },
  accountId: string,
): boolean {
  const brand = ctx.brands?.find((candidate) => candidate.accountId === accountId);
  return brand?.features?.googlePosts === true;
}
