export const TERMS = {
  GBP: 'Google Business Profile',
  PLAN_PRO: 'Professional',
  PLAN_STARTER: 'Starter',
  PLAN_ENTERPRISE: 'Enterprise',
} as const;

export function formatPlanLabel(tier?: string | null): string | null {
  if (!tier) return null;
  const t = tier.toLowerCase();
  if (t === 'pro' || t === 'professional') return TERMS.PLAN_PRO;
  if (t === 'starter' || t === 'free') return TERMS.PLAN_STARTER;
  if (t === 'enterprise' || t === 'business') return TERMS.PLAN_ENTERPRISE;
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

