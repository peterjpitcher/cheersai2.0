import { notFound } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/server';
import { getTournamentById, getFixturesByTournament } from '@/lib/tournament/queries';
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

  return (
    <div className="container mx-auto max-w-7xl py-8 px-4">
      <TournamentHeader
        tournament={tournament}
        fixtures={fixtures}
        preconditionsMissing={preconditions.missing}
      />
      <FixtureTable
        tournament={tournament}
        fixtures={fixtures}
        canGenerate={preconditions.ready}
      />
    </div>
  );
}
