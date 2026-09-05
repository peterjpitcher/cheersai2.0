import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/actions/tournament', () => ({ importFixtures: vi.fn() }));
import { parseCSV } from '@/features/tournament/components/ImportFixturesModal';
import { fixtureCreateSchema } from '@/lib/tournament/validation';
describe('official Nations import preview', () => {
  it('accepts 24 verified candidate rows without inventing end times', () => {
    const result = parseCSV(readFileSync('docs/imports/nations-championship-2026.csv', 'utf8'));
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(24);
    expect(result.rows.filter(row => row.error)).toEqual([]);
    expect(new Set(result.rows.map(row => row.importKey)).size).toBe(24);
    expect(result.rows.filter(row => row.teamsConfirmed)).toHaveLength(18);
    for (const row of result.rows) { expect(fixtureCreateSchema.safeParse(row).success).toBe(true); expect(row.plannedEndAt).toBeNull(); }
  });
});
