import type { BrandFeatures } from '@/lib/auth/types';

/**
 * Per-brand feature switches (SPEC-new-customer-readiness D1b, D1c): the
 * client-safe half. Server-side enforcement lives in src/lib/auth/features.ts.
 */
export type BrandFeature = keyof BrandFeatures;

export const FEATURE_LABELS: Record<BrandFeature, string> = {
  paidAds: 'Paid ads',
  tournaments: 'Tournaments',
  managementImport: 'Management app import',
};

export function hasFeature(holder: { features: BrandFeatures }, feature: BrandFeature): boolean {
  return holder.features[feature] === true;
}
