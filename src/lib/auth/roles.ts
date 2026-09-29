import { requireAuthContext } from '@/lib/auth/server';
import type { AuthContext } from '@/lib/auth/types';

/**
 * Owner-only operations (decision D4): billing, inviting and removing people,
 * Facebook and Instagram connections, export and deletion requests. Members
 * create, edit and schedule content. Super-admins resolve as owner in every
 * brand.
 *
 * Checked server-side in each action: the service-role client bypasses RLS,
 * so hiding a button is never enough.
 */
export class OwnerRequiredError extends Error {
  constructor() {
    super('Only an owner of this brand can do that.');
    this.name = 'OwnerRequiredError';
  }
}

export function isOwner(ctx: Pick<AuthContext, 'role'>): boolean {
  return ctx.role === 'owner';
}

/**
 * Owner (or super-admin) of one particular brand, which may not be the active
 * one: an OAuth flow is attributed to the brand that started it, even if the
 * user switches brand mid-flow.
 */
export function ownsBrand(ctx: Pick<AuthContext, 'brands' | 'isSuperAdmin'>, accountId: string): boolean {
  return ctx.isSuperAdmin || ctx.brands.some((brand) => brand.accountId === accountId && brand.role === 'owner');
}

/** Every brand the caller owns (all brands for a super-admin). */
export function ownedBrandIds(ctx: Pick<AuthContext, 'brands' | 'isSuperAdmin'>): string[] {
  return ctx.brands.filter((brand) => ctx.isSuperAdmin || brand.role === 'owner').map((brand) => brand.accountId);
}

/** Throws OwnerRequiredError (fail closed) unless the caller owns the active brand. */
export function assertOwner(ctx: Pick<AuthContext, 'role'>): void {
  if (!isOwner(ctx)) throw new OwnerRequiredError();
}

/** requireAuthContext() plus the owner check. */
export async function requireOwnerContext(): Promise<AuthContext> {
  const ctx = await requireAuthContext();
  assertOwner(ctx);
  return ctx;
}
