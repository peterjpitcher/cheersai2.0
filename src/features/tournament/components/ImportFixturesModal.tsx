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
        className="w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--c-card)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--sh-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--c-ink)' }}
          >
            Import Fixtures from CSV
          </h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" style={{ color: 'var(--c-ink-3)' }} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p
              className="text-sm mb-2"
              style={{ color: 'var(--c-ink-3)' }}
            >
              Upload a CSV with columns: match_number, round, team_a, team_b, kick_off_at. Optional: group_name, venue_city, showing.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
              style={{
                color: 'var(--c-ink-2)',
              }}
            />
          </div>

          {headerError && (
            <div
              className="p-3 text-sm flex items-center gap-2"
              style={{
                borderRadius: 'var(--r-md)',
                backgroundColor: 'var(--c-claret-soft)',
                color: 'var(--c-claret)',
              }}
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {headerError}
            </div>
          )}

          {rows.length > 0 && !headerError && (
            <>
              <div className="text-sm" style={{ color: 'var(--c-ink-2)' }}>
                <span className="font-medium">{validCount}</span> valid,{' '}
                <span className="font-medium" style={{ color: 'var(--c-claret)' }}>
                  {errorCount}
                </span>{' '}
                errors
              </div>

              <div
                className="overflow-auto max-h-64"
                style={{
                  borderRadius: 'var(--r-lg)',
                  border: '1px solid var(--c-line)',
                }}
              >
                <table className="w-full text-xs">
                  <thead className="sticky top-0" style={{ backgroundColor: 'var(--c-paper-2)' }}>
                    <tr>
                      <th className="eyebrow px-2 py-1 text-left">#</th>
                      <th className="eyebrow px-2 py-1 text-left">Round</th>
                      <th className="eyebrow px-2 py-1 text-left">Team A</th>
                      <th className="eyebrow px-2 py-1 text-left">Team B</th>
                      <th className="eyebrow px-2 py-1 text-left">Kick-off</th>
                      <th className="eyebrow px-2 py-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        style={{
                          backgroundColor: row.error
                            ? 'var(--c-claret-soft)'
                            : i % 2 === 0
                              ? 'var(--c-card)'
                              : 'var(--c-paper)',
                          borderBottom: '1px solid var(--c-line)',
                        }}
                      >
                        <td className="px-2 py-1" style={{ color: 'var(--c-ink-2)' }}>{row.matchNumber}</td>
                        <td className="px-2 py-1" style={{ color: 'var(--c-ink-2)' }}>{row.round}</td>
                        <td className="px-2 py-1" style={{ color: 'var(--c-ink)' }}>{row.teamA}</td>
                        <td className="px-2 py-1" style={{ color: 'var(--c-ink)' }}>{row.teamB}</td>
                        <td className="px-2 py-1" style={{ color: 'var(--c-ink-2)' }}>
                          {row.kickOffAt ? new Date(row.kickOffAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : ''}
                        </td>
                        <td className="px-2 py-1">
                          {row.error ? (
                            <span style={{ color: 'var(--c-claret)' }}>{row.error}</span>
                          ) : (
                            <span style={{ color: 'var(--c-status-posted-fg)' }}>OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div
              className="p-3 text-sm"
              style={{
                borderRadius: 'var(--r-md)',
                backgroundColor: 'var(--c-status-posted-bg)',
                color: 'var(--c-status-posted-fg)',
              }}
            >
              Imported {result.imported} fixtures.{result.errors > 0 && ` ${result.errors} rows had errors.`}
            </div>
          )}

          {error && (
            <div
              className="p-3 text-sm"
              style={{
                borderRadius: 'var(--r-md)',
                backgroundColor: 'var(--c-claret-soft)',
                color: 'var(--c-claret)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm transition-colors"
            style={{
              color: 'var(--c-ink-3)',
              borderRadius: 'var(--r-md)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing || validCount === 0 || !!result}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{
              backgroundColor: 'var(--c-orange)',
              borderRadius: 'var(--r-md)',
            }}
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
