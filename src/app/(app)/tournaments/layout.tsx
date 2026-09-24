import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { hasFeature } from '@/lib/auth/brand-features';
import { requireAuthContext } from '@/lib/auth/server';

/** Tournaments are a per-brand switch; without it every /tournaments page is a 404. */
export default async function TournamentsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuthContext();
  if (!hasFeature(ctx, 'tournaments')) notFound();
  return children;
}
