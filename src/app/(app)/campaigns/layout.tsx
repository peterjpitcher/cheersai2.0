import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { hasFeature } from '@/lib/auth/brand-features';
import { requireAuthContext } from '@/lib/auth/server';

/** Paid ads are a per-brand switch; without it every /campaigns page is a 404. */
export default async function CampaignsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuthContext();
  if (!hasFeature(ctx, 'paidAds')) notFound();
  return children;
}
