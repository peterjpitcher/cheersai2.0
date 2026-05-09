#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Supabase credentials missing – set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const tournamentIdIndex = args.indexOf("--tournament-id");
if (tournamentIdIndex === -1 || !args[tournamentIdIndex + 1]) {
  console.error("Usage: tsx scripts/ops/seed-world-cup-2026.ts --tournament-id <uuid> [--dry-run]");
  process.exit(1);
}

const tournamentId = args[tournamentIdIndex + 1];
const isDryRun = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Round type
// ---------------------------------------------------------------------------

type Round =
  | "group_stage"
  | "round_of_32"
  | "round_of_16"
  | "quarter_final"
  | "semi_final"
  | "third_place"
  | "final";

// ---------------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------------

interface FixtureInput {
  match_number: number;
  round: Round;
  group_name: string | null;
  team_a: string;
  team_b: string;
  teams_confirmed: boolean;
  kick_off_at: string;
  venue_city: string;
  showing: boolean;
}

const fixtures: FixtureInput[] = [
  // -------------------------------------------------------------------------
  // GROUP STAGE
  // -------------------------------------------------------------------------

  // Group A
  { match_number: 1,  round: "group_stage", group_name: "Group A", team_a: "Mexico", team_b: "A2", teams_confirmed: false, kick_off_at: "2026-06-11T23:00:00Z", venue_city: "Mexico City",        showing: true  },
  { match_number: 2,  round: "group_stage", group_name: "Group A", team_a: "A3",     team_b: "A4", teams_confirmed: false, kick_off_at: "2026-06-12T02:00:00Z", venue_city: "Guadalajara",        showing: false },
  { match_number: 13, round: "group_stage", group_name: "Group A", team_a: "Mexico", team_b: "A3", teams_confirmed: false, kick_off_at: "2026-06-16T23:00:00Z", venue_city: "Mexico City",        showing: false },
  { match_number: 14, round: "group_stage", group_name: "Group A", team_a: "A4",     team_b: "A2", teams_confirmed: false, kick_off_at: "2026-06-17T02:00:00Z", venue_city: "Monterrey",          showing: false },
  { match_number: 25, round: "group_stage", group_name: "Group A", team_a: "A4",     team_b: "Mexico", teams_confirmed: false, kick_off_at: "2026-06-21T23:00:00Z", venue_city: "Monterrey",      showing: false },
  { match_number: 26, round: "group_stage", group_name: "Group A", team_a: "A2",     team_b: "A3", teams_confirmed: false, kick_off_at: "2026-06-22T23:00:00Z", venue_city: "Mexico City",        showing: false },

  // Group B
  { match_number: 3,  round: "group_stage", group_name: "Group B", team_a: "B1", team_b: "B2", teams_confirmed: false, kick_off_at: "2026-06-12T14:00:00Z", venue_city: "New York/New Jersey", showing: true  },
  { match_number: 4,  round: "group_stage", group_name: "Group B", team_a: "B3", team_b: "B4", teams_confirmed: false, kick_off_at: "2026-06-12T17:00:00Z", venue_city: "Boston",             showing: false },
  { match_number: 15, round: "group_stage", group_name: "Group B", team_a: "B1", team_b: "B3", teams_confirmed: false, kick_off_at: "2026-06-16T14:00:00Z", venue_city: "New York/New Jersey", showing: false },
  { match_number: 16, round: "group_stage", group_name: "Group B", team_a: "B4", team_b: "B2", teams_confirmed: false, kick_off_at: "2026-06-17T17:00:00Z", venue_city: "Philadelphia",        showing: false },
  { match_number: 27, round: "group_stage", group_name: "Group B", team_a: "B4", team_b: "B1", teams_confirmed: false, kick_off_at: "2026-06-22T20:00:00Z", venue_city: "Philadelphia",        showing: false },
  { match_number: 28, round: "group_stage", group_name: "Group B", team_a: "B2", team_b: "B3", teams_confirmed: false, kick_off_at: "2026-06-22T20:00:00Z", venue_city: "Boston",             showing: false },

  // Group C
  { match_number: 5,  round: "group_stage", group_name: "Group C", team_a: "C1", team_b: "C2", teams_confirmed: false, kick_off_at: "2026-06-12T20:00:00Z", venue_city: "Atlanta",            showing: true  },
  { match_number: 6,  round: "group_stage", group_name: "Group C", team_a: "C3", team_b: "C4", teams_confirmed: false, kick_off_at: "2026-06-12T23:00:00Z", venue_city: "Miami",              showing: false },
  { match_number: 17, round: "group_stage", group_name: "Group C", team_a: "C1", team_b: "C3", teams_confirmed: false, kick_off_at: "2026-06-17T20:00:00Z", venue_city: "Atlanta",            showing: false },
  { match_number: 18, round: "group_stage", group_name: "Group C", team_a: "C4", team_b: "C2", teams_confirmed: false, kick_off_at: "2026-06-17T23:00:00Z", venue_city: "Miami",              showing: false },
  { match_number: 29, round: "group_stage", group_name: "Group C", team_a: "C4", team_b: "C1", teams_confirmed: false, kick_off_at: "2026-06-22T23:00:00Z", venue_city: "Miami",              showing: false },
  { match_number: 30, round: "group_stage", group_name: "Group C", team_a: "C2", team_b: "C3", teams_confirmed: false, kick_off_at: "2026-06-22T23:00:00Z", venue_city: "Atlanta",            showing: false },

  // Group D
  { match_number: 7,  round: "group_stage", group_name: "Group D", team_a: "D1", team_b: "D2", teams_confirmed: false, kick_off_at: "2026-06-13T14:00:00Z", venue_city: "Houston",            showing: true  },
  { match_number: 8,  round: "group_stage", group_name: "Group D", team_a: "D3", team_b: "D4", teams_confirmed: false, kick_off_at: "2026-06-13T17:00:00Z", venue_city: "Dallas",             showing: false },
  { match_number: 19, round: "group_stage", group_name: "Group D", team_a: "D1", team_b: "D3", teams_confirmed: false, kick_off_at: "2026-06-18T14:00:00Z", venue_city: "Houston",            showing: false },
  { match_number: 20, round: "group_stage", group_name: "Group D", team_a: "D4", team_b: "D2", teams_confirmed: false, kick_off_at: "2026-06-18T17:00:00Z", venue_city: "Dallas",             showing: false },
  { match_number: 31, round: "group_stage", group_name: "Group D", team_a: "D4", team_b: "D1", teams_confirmed: false, kick_off_at: "2026-06-23T20:00:00Z", venue_city: "Dallas",             showing: false },
  { match_number: 32, round: "group_stage", group_name: "Group D", team_a: "D2", team_b: "D3", teams_confirmed: false, kick_off_at: "2026-06-23T20:00:00Z", venue_city: "Houston",            showing: false },

  // Group E
  { match_number: 9,  round: "group_stage", group_name: "Group E", team_a: "E1", team_b: "E2", teams_confirmed: false, kick_off_at: "2026-06-13T20:00:00Z", venue_city: "San Francisco",      showing: true  },
  { match_number: 10, round: "group_stage", group_name: "Group E", team_a: "E3", team_b: "E4", teams_confirmed: false, kick_off_at: "2026-06-13T23:00:00Z", venue_city: "Seattle",            showing: false },
  { match_number: 21, round: "group_stage", group_name: "Group E", team_a: "E1", team_b: "E3", teams_confirmed: false, kick_off_at: "2026-06-18T20:00:00Z", venue_city: "San Francisco",      showing: false },
  { match_number: 22, round: "group_stage", group_name: "Group E", team_a: "E4", team_b: "E2", teams_confirmed: false, kick_off_at: "2026-06-18T23:00:00Z", venue_city: "Seattle",            showing: false },
  { match_number: 33, round: "group_stage", group_name: "Group E", team_a: "E4", team_b: "E1", teams_confirmed: false, kick_off_at: "2026-06-23T23:00:00Z", venue_city: "Seattle",            showing: false },
  { match_number: 34, round: "group_stage", group_name: "Group E", team_a: "E2", team_b: "E3", teams_confirmed: false, kick_off_at: "2026-06-23T23:00:00Z", venue_city: "San Francisco",      showing: false },

  // Group F
  { match_number: 11, round: "group_stage", group_name: "Group F", team_a: "F1", team_b: "F2", teams_confirmed: false, kick_off_at: "2026-06-14T02:00:00Z", venue_city: "Los Angeles",        showing: false },
  { match_number: 12, round: "group_stage", group_name: "Group F", team_a: "F3", team_b: "F4", teams_confirmed: false, kick_off_at: "2026-06-14T14:00:00Z", venue_city: "Kansas City",        showing: false },
  { match_number: 23, round: "group_stage", group_name: "Group F", team_a: "F1", team_b: "F3", teams_confirmed: false, kick_off_at: "2026-06-19T02:00:00Z", venue_city: "Los Angeles",        showing: false },
  { match_number: 24, round: "group_stage", group_name: "Group F", team_a: "F4", team_b: "F2", teams_confirmed: false, kick_off_at: "2026-06-19T14:00:00Z", venue_city: "Kansas City",        showing: false },
  { match_number: 35, round: "group_stage", group_name: "Group F", team_a: "F4", team_b: "F1", teams_confirmed: false, kick_off_at: "2026-06-24T20:00:00Z", venue_city: "Kansas City",        showing: false },
  { match_number: 36, round: "group_stage", group_name: "Group F", team_a: "F2", team_b: "F3", teams_confirmed: false, kick_off_at: "2026-06-24T20:00:00Z", venue_city: "Los Angeles",        showing: false },

  // Group G
  { match_number: 37, round: "group_stage", group_name: "Group G", team_a: "G1", team_b: "G2", teams_confirmed: false, kick_off_at: "2026-06-14T17:00:00Z", venue_city: "Toronto",            showing: true  },
  { match_number: 38, round: "group_stage", group_name: "Group G", team_a: "G3", team_b: "G4", teams_confirmed: false, kick_off_at: "2026-06-14T20:00:00Z", venue_city: "Vancouver",          showing: false },
  { match_number: 39, round: "group_stage", group_name: "Group G", team_a: "G1", team_b: "G3", teams_confirmed: false, kick_off_at: "2026-06-19T17:00:00Z", venue_city: "Toronto",            showing: false },
  { match_number: 40, round: "group_stage", group_name: "Group G", team_a: "G4", team_b: "G2", teams_confirmed: false, kick_off_at: "2026-06-19T20:00:00Z", venue_city: "Vancouver",          showing: false },
  { match_number: 41, round: "group_stage", group_name: "Group G", team_a: "G4", team_b: "G1", teams_confirmed: false, kick_off_at: "2026-06-24T23:00:00Z", venue_city: "Vancouver",          showing: false },
  { match_number: 42, round: "group_stage", group_name: "Group G", team_a: "G2", team_b: "G3", teams_confirmed: false, kick_off_at: "2026-06-24T23:00:00Z", venue_city: "Toronto",            showing: false },

  // Group H
  { match_number: 43, round: "group_stage", group_name: "Group H", team_a: "H1", team_b: "H2", teams_confirmed: false, kick_off_at: "2026-06-14T23:00:00Z", venue_city: "Guadalajara",        showing: true  },
  { match_number: 44, round: "group_stage", group_name: "Group H", team_a: "H3", team_b: "H4", teams_confirmed: false, kick_off_at: "2026-06-15T02:00:00Z", venue_city: "Monterrey",          showing: false },
  { match_number: 45, round: "group_stage", group_name: "Group H", team_a: "H1", team_b: "H3", teams_confirmed: false, kick_off_at: "2026-06-20T23:00:00Z", venue_city: "Monterrey",          showing: false },
  { match_number: 46, round: "group_stage", group_name: "Group H", team_a: "H4", team_b: "H2", teams_confirmed: false, kick_off_at: "2026-06-20T02:00:00Z", venue_city: "Guadalajara",        showing: false },
  { match_number: 47, round: "group_stage", group_name: "Group H", team_a: "H4", team_b: "H1", teams_confirmed: false, kick_off_at: "2026-06-25T20:00:00Z", venue_city: "Monterrey",          showing: false },
  { match_number: 48, round: "group_stage", group_name: "Group H", team_a: "H2", team_b: "H3", teams_confirmed: false, kick_off_at: "2026-06-25T20:00:00Z", venue_city: "Guadalajara",        showing: false },

  // Group I
  { match_number: 49, round: "group_stage", group_name: "Group I", team_a: "I1", team_b: "I2", teams_confirmed: false, kick_off_at: "2026-06-15T14:00:00Z", venue_city: "New York/New Jersey", showing: true  },
  { match_number: 50, round: "group_stage", group_name: "Group I", team_a: "I3", team_b: "I4", teams_confirmed: false, kick_off_at: "2026-06-15T17:00:00Z", venue_city: "Philadelphia",        showing: false },
  { match_number: 51, round: "group_stage", group_name: "Group I", team_a: "I1", team_b: "I3", teams_confirmed: false, kick_off_at: "2026-06-20T14:00:00Z", venue_city: "New York/New Jersey", showing: false },
  { match_number: 52, round: "group_stage", group_name: "Group I", team_a: "I4", team_b: "I2", teams_confirmed: false, kick_off_at: "2026-06-20T17:00:00Z", venue_city: "Philadelphia",        showing: false },
  { match_number: 53, round: "group_stage", group_name: "Group I", team_a: "I4", team_b: "I1", teams_confirmed: false, kick_off_at: "2026-06-25T23:00:00Z", venue_city: "Philadelphia",        showing: false },
  { match_number: 54, round: "group_stage", group_name: "Group I", team_a: "I2", team_b: "I3", teams_confirmed: false, kick_off_at: "2026-06-25T23:00:00Z", venue_city: "New York/New Jersey", showing: false },

  // Group J
  { match_number: 55, round: "group_stage", group_name: "Group J", team_a: "J1", team_b: "J2", teams_confirmed: false, kick_off_at: "2026-06-15T20:00:00Z", venue_city: "Atlanta",            showing: true  },
  { match_number: 56, round: "group_stage", group_name: "Group J", team_a: "J3", team_b: "J4", teams_confirmed: false, kick_off_at: "2026-06-15T23:00:00Z", venue_city: "Miami",              showing: false },
  { match_number: 57, round: "group_stage", group_name: "Group J", team_a: "J1", team_b: "J3", teams_confirmed: false, kick_off_at: "2026-06-20T20:00:00Z", venue_city: "Atlanta",            showing: false },
  { match_number: 58, round: "group_stage", group_name: "Group J", team_a: "J4", team_b: "J2", teams_confirmed: false, kick_off_at: "2026-06-20T23:00:00Z", venue_city: "Miami",              showing: false },
  { match_number: 59, round: "group_stage", group_name: "Group J", team_a: "J4", team_b: "J1", teams_confirmed: false, kick_off_at: "2026-06-26T20:00:00Z", venue_city: "Miami",              showing: false },
  { match_number: 60, round: "group_stage", group_name: "Group J", team_a: "J2", team_b: "J3", teams_confirmed: false, kick_off_at: "2026-06-26T20:00:00Z", venue_city: "Atlanta",            showing: false },

  // Group K
  { match_number: 61, round: "group_stage", group_name: "Group K", team_a: "K1", team_b: "K2", teams_confirmed: false, kick_off_at: "2026-06-16T02:00:00Z", venue_city: "Los Angeles",        showing: false },
  { match_number: 62, round: "group_stage", group_name: "Group K", team_a: "K3", team_b: "K4", teams_confirmed: false, kick_off_at: "2026-06-16T14:00:00Z", venue_city: "Kansas City",        showing: false },
  { match_number: 63, round: "group_stage", group_name: "Group K", team_a: "K1", team_b: "K3", teams_confirmed: false, kick_off_at: "2026-06-21T02:00:00Z", venue_city: "Los Angeles",        showing: false },
  { match_number: 64, round: "group_stage", group_name: "Group K", team_a: "K4", team_b: "K2", teams_confirmed: false, kick_off_at: "2026-06-21T14:00:00Z", venue_city: "Kansas City",        showing: false },
  { match_number: 65, round: "group_stage", group_name: "Group K", team_a: "K4", team_b: "K1", teams_confirmed: false, kick_off_at: "2026-06-26T23:00:00Z", venue_city: "Kansas City",        showing: false },
  { match_number: 66, round: "group_stage", group_name: "Group K", team_a: "K2", team_b: "K3", teams_confirmed: false, kick_off_at: "2026-06-26T23:00:00Z", venue_city: "Los Angeles",        showing: false },

  // Group L
  { match_number: 67, round: "group_stage", group_name: "Group L", team_a: "L1", team_b: "L2", teams_confirmed: false, kick_off_at: "2026-06-16T17:00:00Z", venue_city: "Toronto",            showing: true  },
  { match_number: 68, round: "group_stage", group_name: "Group L", team_a: "L3", team_b: "L4", teams_confirmed: false, kick_off_at: "2026-06-16T20:00:00Z", venue_city: "Vancouver",          showing: false },
  { match_number: 69, round: "group_stage", group_name: "Group L", team_a: "L1", team_b: "L3", teams_confirmed: false, kick_off_at: "2026-06-21T17:00:00Z", venue_city: "Toronto",            showing: false },
  { match_number: 70, round: "group_stage", group_name: "Group L", team_a: "L4", team_b: "L2", teams_confirmed: false, kick_off_at: "2026-06-21T20:00:00Z", venue_city: "Vancouver",          showing: false },
  { match_number: 71, round: "group_stage", group_name: "Group L", team_a: "L4", team_b: "L1", teams_confirmed: false, kick_off_at: "2026-06-27T20:00:00Z", venue_city: "Vancouver",          showing: false },
  { match_number: 72, round: "group_stage", group_name: "Group L", team_a: "L2", team_b: "L3", teams_confirmed: false, kick_off_at: "2026-06-27T20:00:00Z", venue_city: "Toronto",            showing: false },

  // -------------------------------------------------------------------------
  // ROUND OF 32 (Matches 73-88)
  // -------------------------------------------------------------------------
  { match_number: 73, round: "round_of_32", group_name: null, team_a: "1A",  team_b: "3C/D/E", teams_confirmed: false, kick_off_at: "2026-06-28T14:00:00Z", venue_city: "New York/New Jersey", showing: true },
  { match_number: 74, round: "round_of_32", group_name: null, team_a: "2B",  team_b: "2C",     teams_confirmed: false, kick_off_at: "2026-06-28T17:00:00Z", venue_city: "Philadelphia",        showing: true },
  { match_number: 75, round: "round_of_32", group_name: null, team_a: "1B",  team_b: "3A/D/E", teams_confirmed: false, kick_off_at: "2026-06-28T20:00:00Z", venue_city: "Boston",             showing: true },
  { match_number: 76, round: "round_of_32", group_name: null, team_a: "2A",  team_b: "2D",     teams_confirmed: false, kick_off_at: "2026-06-28T23:00:00Z", venue_city: "Mexico City",        showing: true },
  { match_number: 77, round: "round_of_32", group_name: null, team_a: "1D",  team_b: "3B/F/G", teams_confirmed: false, kick_off_at: "2026-06-29T14:00:00Z", venue_city: "Houston",            showing: true },
  { match_number: 78, round: "round_of_32", group_name: null, team_a: "1C",  team_b: "3A/B/F", teams_confirmed: false, kick_off_at: "2026-06-29T17:00:00Z", venue_city: "Atlanta",            showing: true },
  { match_number: 79, round: "round_of_32", group_name: null, team_a: "2E",  team_b: "2F",     teams_confirmed: false, kick_off_at: "2026-06-29T20:00:00Z", venue_city: "San Francisco",      showing: true },
  { match_number: 80, round: "round_of_32", group_name: null, team_a: "1E",  team_b: "3G/H/I", teams_confirmed: false, kick_off_at: "2026-06-29T23:00:00Z", venue_city: "Seattle",            showing: true },
  { match_number: 81, round: "round_of_32", group_name: null, team_a: "1G",  team_b: "3I/J/K", teams_confirmed: false, kick_off_at: "2026-06-30T14:00:00Z", venue_city: "Toronto",            showing: true },
  { match_number: 82, round: "round_of_32", group_name: null, team_a: "2H",  team_b: "2I",     teams_confirmed: false, kick_off_at: "2026-06-30T17:00:00Z", venue_city: "Vancouver",          showing: true },
  { match_number: 83, round: "round_of_32", group_name: null, team_a: "1F",  team_b: "3G/H/J", teams_confirmed: false, kick_off_at: "2026-06-30T20:00:00Z", venue_city: "Kansas City",        showing: true },
  { match_number: 84, round: "round_of_32", group_name: null, team_a: "2G",  team_b: "2H",     teams_confirmed: false, kick_off_at: "2026-06-30T23:00:00Z", venue_city: "Los Angeles",        showing: true },
  { match_number: 85, round: "round_of_32", group_name: null, team_a: "1I",  team_b: "3J/K/L", teams_confirmed: false, kick_off_at: "2026-07-01T14:00:00Z", venue_city: "New York/New Jersey", showing: true },
  { match_number: 86, round: "round_of_32", group_name: null, team_a: "1H",  team_b: "3E/F/L", teams_confirmed: false, kick_off_at: "2026-07-01T17:00:00Z", venue_city: "Guadalajara",        showing: true },
  { match_number: 87, round: "round_of_32", group_name: null, team_a: "1J",  team_b: "3I/K/L", teams_confirmed: false, kick_off_at: "2026-07-01T20:00:00Z", venue_city: "Miami",              showing: true },
  { match_number: 88, round: "round_of_32", group_name: null, team_a: "1K",  team_b: "1L",     teams_confirmed: false, kick_off_at: "2026-07-01T23:00:00Z", venue_city: "Dallas",             showing: true },

  // -------------------------------------------------------------------------
  // ROUND OF 16 (Matches 89-96)
  // -------------------------------------------------------------------------
  { match_number: 89, round: "round_of_16", group_name: null, team_a: "W73", team_b: "W76", teams_confirmed: false, kick_off_at: "2026-07-03T17:00:00Z", venue_city: "New York/New Jersey", showing: true },
  { match_number: 90, round: "round_of_16", group_name: null, team_a: "W74", team_b: "W75", teams_confirmed: false, kick_off_at: "2026-07-03T20:00:00Z", venue_city: "Philadelphia",        showing: true },
  { match_number: 91, round: "round_of_16", group_name: null, team_a: "W77", team_b: "W80", teams_confirmed: false, kick_off_at: "2026-07-03T23:00:00Z", venue_city: "Houston",            showing: true },
  { match_number: 92, round: "round_of_16", group_name: null, team_a: "W78", team_b: "W79", teams_confirmed: false, kick_off_at: "2026-07-04T17:00:00Z", venue_city: "Atlanta",            showing: true },
  { match_number: 93, round: "round_of_16", group_name: null, team_a: "W81", team_b: "W84", teams_confirmed: false, kick_off_at: "2026-07-04T20:00:00Z", venue_city: "Toronto",            showing: true },
  { match_number: 94, round: "round_of_16", group_name: null, team_a: "W82", team_b: "W83", teams_confirmed: false, kick_off_at: "2026-07-04T23:00:00Z", venue_city: "Los Angeles",        showing: true },
  { match_number: 95, round: "round_of_16", group_name: null, team_a: "W85", team_b: "W88", teams_confirmed: false, kick_off_at: "2026-07-05T17:00:00Z", venue_city: "New York/New Jersey", showing: true },
  { match_number: 96, round: "round_of_16", group_name: null, team_a: "W86", team_b: "W87", teams_confirmed: false, kick_off_at: "2026-07-05T20:00:00Z", venue_city: "Miami",              showing: true },

  // -------------------------------------------------------------------------
  // QUARTER-FINALS (Matches 97-100)
  // -------------------------------------------------------------------------
  { match_number: 97,  round: "quarter_final", group_name: null, team_a: "W89", team_b: "W90", teams_confirmed: false, kick_off_at: "2026-07-09T17:00:00Z", venue_city: "New York/New Jersey", showing: true },
  { match_number: 98,  round: "quarter_final", group_name: null, team_a: "W91", team_b: "W92", teams_confirmed: false, kick_off_at: "2026-07-09T21:00:00Z", venue_city: "Houston",            showing: true },
  { match_number: 99,  round: "quarter_final", group_name: null, team_a: "W93", team_b: "W94", teams_confirmed: false, kick_off_at: "2026-07-10T17:00:00Z", venue_city: "Los Angeles",        showing: true },
  { match_number: 100, round: "quarter_final", group_name: null, team_a: "W95", team_b: "W96", teams_confirmed: false, kick_off_at: "2026-07-10T21:00:00Z", venue_city: "Miami",              showing: true },

  // -------------------------------------------------------------------------
  // SEMI-FINALS (Matches 101-102)
  // -------------------------------------------------------------------------
  { match_number: 101, round: "semi_final", group_name: null, team_a: "W97", team_b: "W98",  teams_confirmed: false, kick_off_at: "2026-07-14T20:00:00Z", venue_city: "New York/New Jersey", showing: true },
  { match_number: 102, round: "semi_final", group_name: null, team_a: "W99", team_b: "W100", teams_confirmed: false, kick_off_at: "2026-07-15T20:00:00Z", venue_city: "Dallas",             showing: true },

  // -------------------------------------------------------------------------
  // THIRD PLACE (Match 103)
  // -------------------------------------------------------------------------
  { match_number: 103, round: "third_place", group_name: null, team_a: "L101", team_b: "L102", teams_confirmed: false, kick_off_at: "2026-07-18T20:00:00Z", venue_city: "New York/New Jersey", showing: true },

  // -------------------------------------------------------------------------
  // FINAL (Match 104)
  // -------------------------------------------------------------------------
  { match_number: 104, round: "final", group_name: null, team_a: "W101", team_b: "W102", teams_confirmed: false, kick_off_at: "2026-07-19T20:00:00Z", venue_city: "New York/New Jersey", showing: true },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nWorld Cup 2026 Seed Script`);
  console.log(`Tournament ID : ${tournamentId}`);
  console.log(`Fixtures      : ${fixtures.length}`);
  console.log(`Dry run       : ${isDryRun}\n`);

  const rows = fixtures.map((f) => ({
    tournament_id: tournamentId,
    match_number: f.match_number,
    round: f.round,
    group_name: f.group_name,
    team_a: f.team_a,
    team_b: f.team_b,
    teams_confirmed: f.teams_confirmed,
    kick_off_at: f.kick_off_at,
    venue_city: f.venue_city,
    showing: f.showing,
    showing_note: null,
    booking_url: null,
    content_generated: false,
  }));

  if (isDryRun) {
    console.log("DRY RUN — no writes will be made.\n");
    console.log(
      [
        "Match".padEnd(7),
        "Round".padEnd(14),
        "Group".padEnd(8),
        "Team A".padEnd(10),
        "Team B".padEnd(10),
        "KickOff (UTC)".padEnd(22),
        "Showing",
      ].join("  "),
    );
    console.log("─".repeat(90));
    for (const r of rows) {
      console.log(
        [
          String(r.match_number).padEnd(7),
          r.round.padEnd(14),
          (r.group_name ?? "—").padEnd(8),
          r.team_a.padEnd(10),
          r.team_b.padEnd(10),
          r.kick_off_at.padEnd(22),
          r.showing ? "YES" : "no",
        ].join("  "),
      );
    }
    const showingCount = rows.filter((r) => r.showing).length;
    console.log(`\n${rows.length} fixtures total — ${showingCount} marked showing: true`);
    return;
  }

  console.log(`Upserting ${rows.length} fixtures…`);

  const { error, count } = await supabase
    .from("tournament_fixtures")
    .upsert(rows, { onConflict: "tournament_id,match_number", count: "exact" });

  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }

  console.log(`Done. ${count ?? rows.length} rows upserted successfully.`);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
