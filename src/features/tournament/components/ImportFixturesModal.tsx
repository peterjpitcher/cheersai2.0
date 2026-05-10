'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Upload, AlertCircle } from 'lucide-react';
import { importFixtures } from '@/app/actions/tournament';

interface ParsedRow {
  matchNumber: number;
  round: string;
  groupName: string | null;
  teamA: string;
  teamB: string;
  kickOffAt: string;
  venueCity: string | null;
  showing: boolean;
  error?: string;
}

interface ImportFixturesModalProps {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
}

const VALID_ROUNDS = [
  'group_stage', 'round_of_32', 'round_of_16',
  'quarter_final', 'semi_final', 'third_place', 'final',
];

function parseCSV(text: string): { rows: ParsedRow[]; headerError?: string } {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { rows: [], headerError: 'CSV must have a header row and at least one data row' };

  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const required = ['match_number', 'round', 'team_a', 'team_b', 'kick_off_at'];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length) return { rows: [], headerError: `Missing columns: ${missing.join(', ')}` };

  const idx = (name: string): number => header.indexOf(name);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < header.length) {
      rows.push({ matchNumber: 0, round: '', groupName: null, teamA: '', teamB: '', kickOffAt: '', venueCity: null, showing: false, error: 'Too few columns' });
      continue;
    }

    const matchNumber = parseInt(cols[idx('match_number')]);
    const round = cols[idx('round')];
    const teamA = cols[idx('team_a')];
    const teamB = cols[idx('team_b')];
    const kickOffAt = cols[idx('kick_off_at')];
    const groupName = idx('group_name') >= 0 ? cols[idx('group_name')] || null : null;
    const venueCity = idx('venue_city') >= 0 ? cols[idx('venue_city')] || null : null;
    const showing = idx('showing') >= 0 ? cols[idx('showing')].toLowerCase() === 'true' : false;

    let error: string | undefined;
    if (isNaN(matchNumber) || matchNumber < 1) error = 'Invalid match number';
    else if (!VALID_ROUNDS.includes(round)) error = `Invalid round: ${round}`;
    else if (!teamA) error = 'Team A is required';
    else if (!teamB) error = 'Team B is required';
    else if (!kickOffAt || isNaN(Date.parse(kickOffAt))) error = 'Invalid kick-off date';

    rows.push({ matchNumber, round, groupName, teamA, teamB, kickOffAt, venueCity, showing, error });
  }

  return { rows };
}

export function ImportFixturesModal({ open, onClose, tournamentId }: ImportFixturesModalProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setHeaderError(null);
    setResult(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setHeaderError(parsed.headerError ?? null);
      setRows(parsed.rows);
      setResult(null);
      setError(null);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const valid = rows.filter((r) => !r.error);
    if (!valid.length) return;

    setImporting(true);
    setError(null);
    try {
      const res = await importFixtures(tournamentId, valid);
      if (!res.success) {
        setError(res.errors[0]?.error ?? 'Import failed');
        return;
      }
      setResult({ imported: res.imported, errors: res.errors.length });
      if (res.errors.length === 0) {
        setTimeout(onClose, 1500);
      }
    } finally {
      setImporting(false);
    }
  }

  const validCount = rows.filter((r) => !r.error).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import Fixtures"
        tabIndex={-1}
        className="w-full max-w-4xl rounded-lg bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Import Fixtures from CSV</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Upload a CSV with columns: match_number, round, team_a, team_b, kick_off_at. Optional: group_name, venue_city, showing.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
          </div>

          {headerError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {headerError}
            </div>
          )}

          {rows.length > 0 && !headerError && (
            <>
              <div className="text-sm">
                <span className="font-medium">{validCount}</span> valid, <span className="font-medium text-red-600">{errorCount}</span> errors
              </div>

              <div className="rounded-lg border overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Round</th>
                      <th className="px-2 py-1 text-left">Team A</th>
                      <th className="px-2 py-1 text-left">Team B</th>
                      <th className="px-2 py-1 text-left">Kick-off</th>
                      <th className="px-2 py-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row, i) => (
                      <tr key={i} className={row.error ? 'bg-red-50/50' : ''}>
                        <td className="px-2 py-1">{row.matchNumber}</td>
                        <td className="px-2 py-1">{row.round}</td>
                        <td className="px-2 py-1">{row.teamA}</td>
                        <td className="px-2 py-1">{row.teamB}</td>
                        <td className="px-2 py-1">{row.kickOffAt ? new Date(row.kickOffAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : ''}</td>
                        <td className="px-2 py-1">{row.error ? <span className="text-red-600">{row.error}</span> : <span className="text-green-600">OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              Imported {result.imported} fixtures.{result.errors > 0 && ` ${result.errors} rows had errors.`}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing || validCount === 0 || !!result}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
            <Upload className="h-4 w-4" />
            Import {validCount} Fixtures
          </button>
        </div>
      </div>
    </div>
  );
}
