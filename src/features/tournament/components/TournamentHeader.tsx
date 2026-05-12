'use client';

import { useState } from 'react';
import { Loader2, Settings } from 'lucide-react';
import type { Tournament, TournamentFixture } from '@/types/tournament';
import { bulkGenerateAction } from '@/app/actions/tournament';
import { PreconditionWarning } from './PreconditionWarning';
import { TournamentSettingsModal } from './TournamentSettingsModal';

interface TournamentHeaderProps {
  tournament: Tournament;
  fixtures: TournamentFixture[];
  preconditionsMissing: string[];
}

export function TournamentHeader({
  tournament,
  fixtures,
  preconditionsMissing,
}: TournamentHeaderProps) {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    generated?: number;
    failed?: number;
    errorMessage?: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const totalFixtures = fixtures.length;
  const showingCount = fixtures.filter((f) => f.showing).length;
  const confirmedCount = fixtures.filter((f) => f.teamsConfirmed).length;
  const generatedCount = fixtures.filter((f) => f.contentGenerated).length;
  const eligibleCount = fixtures.filter(
    (f) => f.showing && f.teamsConfirmed && !f.contentGenerated,
  ).length;

  const canGenerate = preconditionsMissing.length === 0 && eligibleCount > 0;

  async function handleBulkGenerate() {
    if (!canGenerate || generating) return;
    setGenerating(true);
    setResult(null);

    try {
      const res = await bulkGenerateAction(tournament.id);
      if (res.success) {
        const firstError = res.errors?.[0]?.error;
        setResult({
          generated: res.generated,
          failed: res.errors?.length ?? 0,
          errorMessage: firstError,
        });
      } else {
        setResult({
          generated: 0,
          failed: 0,
          errorMessage: res.error ?? 'Generation failed',
        });
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{tournament.name}</h1>
          <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
            <span>
              {showingCount}/{totalFixtures} showing
            </span>
            <span>{confirmedCount} confirmed</span>
            <span>{generatedCount} scheduled</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>

          <button
            onClick={handleBulkGenerate}
            disabled={!canGenerate || generating}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              !canGenerate
                ? preconditionsMissing.length > 0
                  ? 'Fix preconditions first'
                  : 'No eligible fixtures'
                : `Generate content for ${eligibleCount} fixtures`
            }
          >
            {generating && <Loader2 className="h-4 w-4 animate-spin" />}
            Generate All ({eligibleCount})
          </button>
        </div>
      </div>

      <PreconditionWarning missing={preconditionsMissing} />

      {result && (
        <div className={`rounded-md p-3 text-sm ${result.errorMessage ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
          {result.generated !== undefined && `Generated ${result.generated} fixtures.`}
          {(result.failed ?? 0) > 0 && ` ${result.failed} failed.`}
          {result.errorMessage && (
            <p className="mt-1 text-xs opacity-80">{result.errorMessage}</p>
          )}
        </div>
      )}

      <TournamentSettingsModal
        tournament={tournament}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
