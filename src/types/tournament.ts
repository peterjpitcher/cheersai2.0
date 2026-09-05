export type TournamentStatus = 'draft' | 'active' | 'archived';

export type TournamentRound =
  | 'group_stage'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter_final'
  | 'semi_final'
  | 'third_place'
  | 'final'
  | 'league_round'
  | 'placement_final';

export type TournamentPlatform = 'instagram' | 'facebook';
export type ContentPlacement = 'feed' | 'story';

export interface Tournament {
  id: string;
  accountId: string;
  sport?: TournamentSport;
  name: string;
  slug: string;
  status: TournamentStatus;
  baseImageSquareId: string | null;
  baseImageStoryId: string | null;
  houseRulesText: string | null;
  postTemplate: string;
  platforms: TournamentPlatform[];
  postLeadHours: number;
  feedApiKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TournamentFixture extends Partial<FixtureScreeningFields> {
  id: string;
  tournamentId: string;
  matchNumber: number;
  round: TournamentRound;
  groupName: string | null;
  teamA: string;
  teamB: string;
  teamsConfirmed: boolean;
  kickOffAt: string;
  venueCity: string | null;
  showing: boolean;
  showingNote: string | null;
  bookingUrl: string | null;
  contentGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export type FixtureContentStatus =
  | 'no_teams'
  | 'ready'
  | 'blocked'
  | 'past_due'
  | 'scheduled'
  | 'published'
  | 'not_showing';

export interface TournamentWithStats extends Tournament {
  totalFixtures: number;
  showingCount: number;
  confirmedCount: number;
  scheduledCount: number;
  publishedCount: number;
}

export interface FixtureWithStatus extends TournamentFixture {
  contentStatus: FixtureContentStatus;
}

export type TournamentSport = 'football' | 'rugby_union';
export type ScreeningDecision = 'unconfirmed' | 'confirmed' | 'not_showing';
export type BroadcastDecision = 'unconfirmed' | 'confirmed' | 'not_linear';
export type Commentary = 'unconfirmed' | 'on' | 'off';
export type Coverage = 'full' | 'from_opening';
export interface FixtureScreeningFields {
  importKey: string | null;
  roundNumber: number | null;
  finalPosition: number | null;
  plannedEndAt: string | null;
  matchState: 'scheduled' | 'in_progress' | 'finished' | 'cancelled';
  screeningDecision: ScreeningDecision;
  broadcastDecision: BroadcastDecision;
  linearChannel: string | null;
  screenLabel: string | null;
  commentary: Commentary;
  sourceUrl: string | null;
  sourceCheckedAt: string | null;
  broadcastCheckedAt: string | null;
  screeningConfirmedAt: string | null;
  contentRevision: number;
}
export interface ScreeningFacts extends Omit<FixtureScreeningFields, 'importKey'> {
  id: string;
  importKey: string;
  sport: TournamentSport;
  round: string;
  teamA: string;
  teamB: string;
  teamsConfirmed: boolean;
  kickOffAt: string;
  coverage: Coverage;
  bookingUrl: string | null;
}
