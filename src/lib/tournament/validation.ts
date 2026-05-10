import { z } from 'zod';
import type { Tournament } from '@/types/tournament';

export const tournamentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Lowercase alphanumeric and hyphens only'),
  postTemplate: z.string().min(1).max(500),
  houseRulesText: z.string().max(200).optional().nullable(),
  platforms: z.array(z.enum(['instagram', 'facebook'])).min(1),
  postLeadHours: z.number().int().min(1).max(168).default(24),
});

export const tournamentUpdateSchema = tournamentCreateSchema.partial();

export const fixtureCreateSchema = z.object({
  matchNumber: z.number().int().positive(),
  round: z.enum([
    'group_stage',
    'round_of_32',
    'round_of_16',
    'quarter_final',
    'semi_final',
    'third_place',
    'final',
  ]),
  groupName: z.string().max(20).optional().nullable(),
  teamA: z.string().min(1).max(50),
  teamB: z.string().min(1).max(50),
  kickOffAt: z.string().datetime(),
  venueCity: z.string().max(100).optional().nullable(),
  showing: z.boolean().default(false),
  showingNote: z.string().max(200).optional().nullable(),
  bookingUrl: z
    .string()
    .url()
    .startsWith('https://')
    .optional()
    .nullable()
    .or(z.literal('')),
});

export const fixtureUpdateSchema = z.object({
  teamA: z.string().min(1).max(50),
  teamB: z.string().min(1).max(50),
  teamsConfirmed: z.boolean(),
  showing: z.boolean(),
  showingNote: z.string().max(200).optional().nullable(),
  bookingUrl: z.string().url().startsWith('https://').optional().nullable()
    .or(z.literal('')),
  kickOffAt: z.string().datetime(),
});

export interface TournamentPreconditionResult {
  ready: boolean;
  missing: string[];
}

export function checkTournamentPreconditions(
  tournament: Tournament,
  hasConnections: Record<string, boolean>,
): TournamentPreconditionResult {
  const missing: string[] = [];

  if (tournament.status !== 'active') {
    missing.push('Tournament must be active');
  }
  if (!tournament.baseImageSquareId) {
    missing.push('Square base image required');
  }
  if (!tournament.baseImageStoryId) {
    missing.push('Story base image required');
  }
  if (!tournament.postTemplate?.trim()) {
    missing.push('Post template required');
  }
  if (!tournament.platforms.length) {
    missing.push('At least one platform required');
  }
  for (const platform of tournament.platforms) {
    if (!hasConnections[platform]) {
      missing.push(`${platform} connection required`);
    }
  }

  return { ready: missing.length === 0, missing };
}
