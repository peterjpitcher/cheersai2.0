import { z } from 'zod';
import type { Tournament } from '@/types/tournament';

export const tournamentCreateSchema = z.object({
  sport: z.enum(['football', 'rugby_union']).optional(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Lowercase alphanumeric and hyphens only'),
  postTemplate: z.string().min(1).max(500),
  houseRulesText: z.string().max(200).optional().nullable(),
  platforms: z.array(z.enum(['instagram', 'facebook'])).min(1),
  postLeadHours: z.number().int().min(1).max(168).default(24),
});

export const tournamentUpdateSchema = tournamentCreateSchema.partial();

const tournamentRoundSchema = z.enum([
  'group_stage',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
  'league_round',
  'placement_final',
]);

const bookingUrlSchema = z
  .string()
  .url()
  .startsWith('https://')
  .optional()
  .nullable()
  .or(z.literal(''));

const isoDatetimeSchema = z.string().datetime({ offset: true });

const screeningFields = {
  importKey: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).nullable().optional(),
  roundNumber: z.number().int().min(1).max(6).nullable().optional(),
  finalPosition: z.number().int().min(1).max(6).nullable().optional(),
  plannedEndAt: isoDatetimeSchema.nullable().optional(),
  matchState: z.enum(['scheduled', 'in_progress', 'finished', 'cancelled']).optional(),
  screeningDecision: z.enum(['unconfirmed', 'confirmed', 'not_showing']).optional(),
  broadcastDecision: z.enum(['unconfirmed', 'confirmed', 'not_linear']).optional(),
  linearChannel: z.string().trim().min(1).max(100).nullable().optional(),
  screenLabel: z.string().trim().min(1).max(100).nullable().optional(),
  commentary: z.enum(['unconfirmed', 'on', 'off']).optional(),
  sourceUrl: bookingUrlSchema,
  sourceCheckedAt: isoDatetimeSchema.nullable().optional(),
  broadcastCheckedAt: isoDatetimeSchema.nullable().optional(),
  screeningConfirmedAt: isoDatetimeSchema.nullable().optional(),
  contentRevision: z.number().int().positive().optional(),
};

export const fixtureCreateSchema = z.object({
  ...screeningFields,
  teamsConfirmed: z.boolean().optional(),
  matchNumber: z.number().int().positive(),
  round: tournamentRoundSchema,
  groupName: z.string().max(20).optional().nullable(),
  teamA: z.string().min(1).max(50),
  teamB: z.string().min(1).max(50),
  kickOffAt: isoDatetimeSchema,
  venueCity: z.string().max(100).optional().nullable(),
  showing: z.boolean().default(false),
  showingNote: z.string().max(200).optional().nullable(),
  bookingUrl: bookingUrlSchema,
});

export const fixtureUpdateSchema = z.object({
  ...screeningFields,
  matchNumber: z.number().int().positive().optional(),
  round: tournamentRoundSchema.optional(),
  groupName: z.string().max(20).optional().nullable(),
  teamA: z.string().min(1).max(50),
  teamB: z.string().min(1).max(50),
  teamsConfirmed: z.boolean(),
  showing: z.boolean(),
  showingNote: z.string().max(200).optional().nullable(),
  bookingUrl: bookingUrlSchema,
  kickOffAt: isoDatetimeSchema,
  venueCity: z.string().max(100).optional().nullable(),
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
