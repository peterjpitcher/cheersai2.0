export type TournamentStatus = 'draft' | 'active' | 'archived';

export type TournamentRound =
  | 'group_stage'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter_final'
  | 'semi_final'
  | 'third_place'
  | 'final';

export type TournamentPlatform = 'instagram' | 'facebook';
export type ContentPlacement = 'feed' | 'story';

export interface Tournament {
  id: string;
  accountId: string;
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

export interface TournamentFixture {
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
