import { notFound } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/server';
import { getTournamentById, getFixturesByTournament, deriveFixtureContentStatuses } from '@/lib/tournament/queries';
import { checkTournamentPreconditions } from '@/lib/tournament/validation';
import { TournamentHeader } from '@/features/tournament/components/TournamentHeader';
import { FixtureTable } from '@/features/tournament/components/FixtureTable';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TournamentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { supabase, accountId } = await requireAuthContext();

  const tournament = await getTournamentById(supabase, id, accountId);
  if (!tournament) notFound();

  const fixtures = await getFixturesByTournament(supabase, id);

  const connections: Record<string, boolean> = {};
  for (const platform of tournament.platforms) {
    const { data: conn } = await supabase
      .from('social_connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', platform)
      .limit(1);
    connections[platform] = (conn?.length ?? 0) > 0;
  }

  const preconditions = checkTournamentPreconditions(tournament, connections);

  const contentStatuses = await deriveFixtureContentStatuses(supabase, fixtures, accountId);
  const contentStatusRecord: Record<string, string> = {};
  for (const [fId, status] of contentStatuses) {
    contentStatusRecord[fId] = status;
  }

  return (
    <div
      className="container mx-auto max-w-7xl py-6 px-3 sm:py-8 sm:px-4"
      style={{ color: 'var(--c-ink)' }}
    >
      <TournamentHeader
        tournament={tournament}
        fixtures={fixtures}
        preconditionsMissing={preconditions.missing}
      />
      <FixtureTable
        tournament={tournament}
        fixtures={fixtures}
        canGenerate={preconditions.ready}
        contentStatuses={contentStatusRecord}
      />
    </div>
  );
}
