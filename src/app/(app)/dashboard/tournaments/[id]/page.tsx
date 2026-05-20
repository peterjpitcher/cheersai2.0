import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Legacy route — redirects to /tournaments/[id].
 * Tournaments moved to root-level route for consistency with other sections.
 */
export default async function LegacyTournamentDetailPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/tournaments/${id}`);
}
