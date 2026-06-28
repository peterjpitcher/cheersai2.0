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
  { match_number: 1, round: "group_stage", group_name: "A", team_a: "Mexico", team_b: "South Africa", teams_confirmed: true, kick_off_at: "2026-06-11T19:00:00Z", venue_city: "Mexico City, Mexico", showing: true },
  { match_number: 2, round: "group_stage", group_name: "A", team_a: "Korea Republic", team_b: "Czechia", teams_confirmed: true, kick_off_at: "2026-06-12T02:00:00Z", venue_city: "Guadalajara, Mexico", showing: false },
  { match_number: 3, round: "group_stage", group_name: "B", team_a: "Canada", team_b: "Bosnia and Herzegovina", teams_confirmed: true, kick_off_at: "2026-06-12T19:00:00Z", venue_city: "Toronto, Canada", showing: true },
  { match_number: 4, round: "group_stage", group_name: "D", team_a: "USA", team_b: "Paraguay", teams_confirmed: true, kick_off_at: "2026-06-13T01:00:00Z", venue_city: "Los Angeles, USA", showing: false },
  { match_number: 5, round: "group_stage", group_name: "C", team_a: "Haiti", team_b: "Scotland", teams_confirmed: true, kick_off_at: "2026-06-14T01:00:00Z", venue_city: "Boston, USA", showing: false },
  { match_number: 6, round: "group_stage", group_name: "D", team_a: "Australia", team_b: "Türkiye", teams_confirmed: true, kick_off_at: "2026-06-14T04:00:00Z", venue_city: "Vancouver, Canada", showing: false },
  { match_number: 7, round: "group_stage", group_name: "C", team_a: "Brazil", team_b: "Morocco", teams_confirmed: true, kick_off_at: "2026-06-13T22:00:00Z", venue_city: "New York, USA", showing: false },
  { match_number: 8, round: "group_stage", group_name: "B", team_a: "Qatar", team_b: "Switzerland", teams_confirmed: true, kick_off_at: "2026-06-13T19:00:00Z", venue_city: "San Francisco Bay Area, USA", showing: true },
  { match_number: 9, round: "group_stage", group_name: "E", team_a: "Côte d'Ivoire", team_b: "Ecuador", teams_confirmed: true, kick_off_at: "2026-06-14T23:00:00Z", venue_city: "Philadelphia, USA", showing: false },
  { match_number: 10, round: "group_stage", group_name: "E", team_a: "Germany", team_b: "Curaçao", teams_confirmed: true, kick_off_at: "2026-06-14T17:00:00Z", venue_city: "Houston, USA", showing: true },
  { match_number: 11, round: "group_stage", group_name: "F", team_a: "Netherlands", team_b: "Japan", teams_confirmed: true, kick_off_at: "2026-06-14T20:00:00Z", venue_city: "Dallas, USA", showing: true },
  { match_number: 12, round: "group_stage", group_name: "F", team_a: "Sweden", team_b: "Tunisia", teams_confirmed: true, kick_off_at: "2026-06-15T02:00:00Z", venue_city: "Monterrey, Mexico", showing: false },
  { match_number: 13, round: "group_stage", group_name: "H", team_a: "Saudi Arabia", team_b: "Uruguay", teams_confirmed: true, kick_off_at: "2026-06-15T22:00:00Z", venue_city: "Miami, USA", showing: false },
  { match_number: 14, round: "group_stage", group_name: "H", team_a: "Spain", team_b: "Cabo Verde", teams_confirmed: true, kick_off_at: "2026-06-15T16:00:00Z", venue_city: "Atlanta, USA", showing: true },
  { match_number: 15, round: "group_stage", group_name: "G", team_a: "IR Iran", team_b: "New Zealand", teams_confirmed: true, kick_off_at: "2026-06-16T01:00:00Z", venue_city: "Los Angeles, USA", showing: false },
  { match_number: 16, round: "group_stage", group_name: "G", team_a: "Belgium", team_b: "Egypt", teams_confirmed: true, kick_off_at: "2026-06-15T19:00:00Z", venue_city: "Seattle, USA", showing: true },
  { match_number: 17, round: "group_stage", group_name: "I", team_a: "France", team_b: "Senegal", teams_confirmed: true, kick_off_at: "2026-06-16T19:00:00Z", venue_city: "New York, USA", showing: true },
  { match_number: 18, round: "group_stage", group_name: "I", team_a: "Iraq", team_b: "Norway", teams_confirmed: true, kick_off_at: "2026-06-16T22:00:00Z", venue_city: "Boston, USA", showing: false },
  { match_number: 19, round: "group_stage", group_name: "J", team_a: "Argentina", team_b: "Algeria", teams_confirmed: true, kick_off_at: "2026-06-17T01:00:00Z", venue_city: "Kansas City, USA", showing: false },
  { match_number: 20, round: "group_stage", group_name: "J", team_a: "Austria", team_b: "Jordan", teams_confirmed: true, kick_off_at: "2026-06-17T04:00:00Z", venue_city: "San Francisco Bay Area, USA", showing: false },
  { match_number: 21, round: "group_stage", group_name: "L", team_a: "Ghana", team_b: "Panama", teams_confirmed: true, kick_off_at: "2026-06-17T23:00:00Z", venue_city: "Toronto, Canada", showing: false },
  { match_number: 22, round: "group_stage", group_name: "L", team_a: "England", team_b: "Croatia", teams_confirmed: true, kick_off_at: "2026-06-17T20:00:00Z", venue_city: "Dallas, USA", showing: true },
  { match_number: 23, round: "group_stage", group_name: "K", team_a: "Portugal", team_b: "Congo DR", teams_confirmed: true, kick_off_at: "2026-06-17T17:00:00Z", venue_city: "Houston, USA", showing: true },
  { match_number: 24, round: "group_stage", group_name: "K", team_a: "Uzbekistan", team_b: "Colombia", teams_confirmed: true, kick_off_at: "2026-06-18T02:00:00Z", venue_city: "Mexico City, Mexico", showing: false },
  { match_number: 25, round: "group_stage", group_name: "A", team_a: "Czechia", team_b: "South Africa", teams_confirmed: true, kick_off_at: "2026-06-18T16:00:00Z", venue_city: "Atlanta, USA", showing: true },
  { match_number: 26, round: "group_stage", group_name: "B", team_a: "Switzerland", team_b: "Bosnia and Herzegovina", teams_confirmed: true, kick_off_at: "2026-06-18T19:00:00Z", venue_city: "Los Angeles, USA", showing: true },
  { match_number: 27, round: "group_stage", group_name: "B", team_a: "Canada", team_b: "Qatar", teams_confirmed: true, kick_off_at: "2026-06-18T22:00:00Z", venue_city: "Vancouver, Canada", showing: false },
  { match_number: 28, round: "group_stage", group_name: "A", team_a: "Mexico", team_b: "Korea Republic", teams_confirmed: true, kick_off_at: "2026-06-19T01:00:00Z", venue_city: "Guadalajara, Mexico", showing: false },
  { match_number: 29, round: "group_stage", group_name: "C", team_a: "Brazil", team_b: "Haiti", teams_confirmed: true, kick_off_at: "2026-06-20T00:30:00Z", venue_city: "Philadelphia, USA", showing: false },
  { match_number: 30, round: "group_stage", group_name: "C", team_a: "Scotland", team_b: "Morocco", teams_confirmed: true, kick_off_at: "2026-06-19T22:00:00Z", venue_city: "Boston, USA", showing: false },
  { match_number: 31, round: "group_stage", group_name: "D", team_a: "Türkiye", team_b: "Paraguay", teams_confirmed: true, kick_off_at: "2026-06-20T03:00:00Z", venue_city: "San Francisco Bay Area, USA", showing: false },
  { match_number: 32, round: "group_stage", group_name: "D", team_a: "USA", team_b: "Australia", teams_confirmed: true, kick_off_at: "2026-06-19T19:00:00Z", venue_city: "Seattle, USA", showing: true },
  { match_number: 33, round: "group_stage", group_name: "E", team_a: "Germany", team_b: "Côte d'Ivoire", teams_confirmed: true, kick_off_at: "2026-06-20T20:00:00Z", venue_city: "Toronto, Canada", showing: true },
  { match_number: 34, round: "group_stage", group_name: "E", team_a: "Ecuador", team_b: "Curaçao", teams_confirmed: true, kick_off_at: "2026-06-21T00:00:00Z", venue_city: "Kansas City, USA", showing: false },
  { match_number: 35, round: "group_stage", group_name: "F", team_a: "Netherlands", team_b: "Sweden", teams_confirmed: true, kick_off_at: "2026-06-20T17:00:00Z", venue_city: "Houston, USA", showing: true },
  { match_number: 36, round: "group_stage", group_name: "F", team_a: "Tunisia", team_b: "Japan", teams_confirmed: true, kick_off_at: "2026-06-21T04:00:00Z", venue_city: "Monterrey, Mexico", showing: false },
  { match_number: 37, round: "group_stage", group_name: "H", team_a: "Uruguay", team_b: "Cabo Verde", teams_confirmed: true, kick_off_at: "2026-06-21T22:00:00Z", venue_city: "Miami, USA", showing: false },
  { match_number: 38, round: "group_stage", group_name: "H", team_a: "Spain", team_b: "Saudi Arabia", teams_confirmed: true, kick_off_at: "2026-06-21T16:00:00Z", venue_city: "Atlanta, USA", showing: true },
  { match_number: 39, round: "group_stage", group_name: "G", team_a: "Belgium", team_b: "IR Iran", teams_confirmed: true, kick_off_at: "2026-06-21T19:00:00Z", venue_city: "Los Angeles, USA", showing: true },
  { match_number: 40, round: "group_stage", group_name: "G", team_a: "New Zealand", team_b: "Egypt", teams_confirmed: true, kick_off_at: "2026-06-22T01:00:00Z", venue_city: "Vancouver, Canada", showing: false },
  { match_number: 41, round: "group_stage", group_name: "I", team_a: "Norway", team_b: "Senegal", teams_confirmed: true, kick_off_at: "2026-06-23T00:00:00Z", venue_city: "New York, USA", showing: false },
  { match_number: 42, round: "group_stage", group_name: "I", team_a: "France", team_b: "Iraq", teams_confirmed: true, kick_off_at: "2026-06-22T21:00:00Z", venue_city: "Philadelphia, USA", showing: true },
  { match_number: 43, round: "group_stage", group_name: "J", team_a: "Argentina", team_b: "Austria", teams_confirmed: true, kick_off_at: "2026-06-22T17:00:00Z", venue_city: "Dallas, USA", showing: true },
  { match_number: 44, round: "group_stage", group_name: "J", team_a: "Jordan", team_b: "Algeria", teams_confirmed: true, kick_off_at: "2026-06-23T03:00:00Z", venue_city: "San Francisco Bay Area, USA", showing: false },
  { match_number: 45, round: "group_stage", group_name: "L", team_a: "England", team_b: "Ghana", teams_confirmed: true, kick_off_at: "2026-06-23T20:00:00Z", venue_city: "Boston, USA", showing: true },
  { match_number: 46, round: "group_stage", group_name: "L", team_a: "Panama", team_b: "Croatia", teams_confirmed: true, kick_off_at: "2026-06-23T23:00:00Z", venue_city: "Toronto, Canada", showing: false },
  { match_number: 47, round: "group_stage", group_name: "K", team_a: "Portugal", team_b: "Uzbekistan", teams_confirmed: true, kick_off_at: "2026-06-23T17:00:00Z", venue_city: "Houston, USA", showing: true },
  { match_number: 48, round: "group_stage", group_name: "K", team_a: "Colombia", team_b: "Congo DR", teams_confirmed: true, kick_off_at: "2026-06-24T02:00:00Z", venue_city: "Guadalajara, Mexico", showing: false },
  { match_number: 49, round: "group_stage", group_name: "C", team_a: "Scotland", team_b: "Brazil", teams_confirmed: true, kick_off_at: "2026-06-24T22:00:00Z", venue_city: "Miami, USA", showing: false },
  { match_number: 50, round: "group_stage", group_name: "C", team_a: "Morocco", team_b: "Haiti", teams_confirmed: true, kick_off_at: "2026-06-24T22:00:00Z", venue_city: "Atlanta, USA", showing: false },
  { match_number: 51, round: "group_stage", group_name: "B", team_a: "Switzerland", team_b: "Canada", teams_confirmed: true, kick_off_at: "2026-06-24T19:00:00Z", venue_city: "Vancouver, Canada", showing: true },
  { match_number: 52, round: "group_stage", group_name: "B", team_a: "Bosnia and Herzegovina", team_b: "Qatar", teams_confirmed: true, kick_off_at: "2026-06-24T19:00:00Z", venue_city: "Seattle, USA", showing: true },
  { match_number: 53, round: "group_stage", group_name: "A", team_a: "Czechia", team_b: "Mexico", teams_confirmed: true, kick_off_at: "2026-06-25T01:00:00Z", venue_city: "Mexico City, Mexico", showing: false },
  { match_number: 54, round: "group_stage", group_name: "A", team_a: "South Africa", team_b: "Korea Republic", teams_confirmed: true, kick_off_at: "2026-06-25T01:00:00Z", venue_city: "Monterrey, Mexico", showing: false },
  { match_number: 55, round: "group_stage", group_name: "E", team_a: "Curaçao", team_b: "Côte d'Ivoire", teams_confirmed: true, kick_off_at: "2026-06-25T20:00:00Z", venue_city: "Philadelphia, USA", showing: true },
  { match_number: 56, round: "group_stage", group_name: "E", team_a: "Ecuador", team_b: "Germany", teams_confirmed: true, kick_off_at: "2026-06-25T20:00:00Z", venue_city: "New York, USA", showing: true },
  { match_number: 57, round: "group_stage", group_name: "F", team_a: "Japan", team_b: "Sweden", teams_confirmed: true, kick_off_at: "2026-06-25T23:00:00Z", venue_city: "Dallas, USA", showing: false },
  { match_number: 58, round: "group_stage", group_name: "F", team_a: "Tunisia", team_b: "Netherlands", teams_confirmed: true, kick_off_at: "2026-06-25T23:00:00Z", venue_city: "Kansas City, USA", showing: false },
  { match_number: 59, round: "group_stage", group_name: "D", team_a: "Türkiye", team_b: "USA", teams_confirmed: true, kick_off_at: "2026-06-26T02:00:00Z", venue_city: "Los Angeles, USA", showing: false },
  { match_number: 60, round: "group_stage", group_name: "D", team_a: "Paraguay", team_b: "Australia", teams_confirmed: true, kick_off_at: "2026-06-26T02:00:00Z", venue_city: "San Francisco Bay Area, USA", showing: false },
  { match_number: 61, round: "group_stage", group_name: "I", team_a: "Norway", team_b: "France", teams_confirmed: true, kick_off_at: "2026-06-26T19:00:00Z", venue_city: "Boston, USA", showing: true },
  { match_number: 62, round: "group_stage", group_name: "I", team_a: "Senegal", team_b: "Iraq", teams_confirmed: true, kick_off_at: "2026-06-26T19:00:00Z", venue_city: "Toronto, Canada", showing: true },
  { match_number: 63, round: "group_stage", group_name: "G", team_a: "Egypt", team_b: "IR Iran", teams_confirmed: true, kick_off_at: "2026-06-27T03:00:00Z", venue_city: "Seattle, USA", showing: false },
  { match_number: 64, round: "group_stage", group_name: "G", team_a: "New Zealand", team_b: "Belgium", teams_confirmed: true, kick_off_at: "2026-06-27T03:00:00Z", venue_city: "Vancouver, Canada", showing: false },
  { match_number: 65, round: "group_stage", group_name: "H", team_a: "Cabo Verde", team_b: "Saudi Arabia", teams_confirmed: true, kick_off_at: "2026-06-27T00:00:00Z", venue_city: "Houston, USA", showing: false },
  { match_number: 66, round: "group_stage", group_name: "H", team_a: "Uruguay", team_b: "Spain", teams_confirmed: true, kick_off_at: "2026-06-27T00:00:00Z", venue_city: "Guadalajara, Mexico", showing: false },
  { match_number: 67, round: "group_stage", group_name: "L", team_a: "Panama", team_b: "England", teams_confirmed: true, kick_off_at: "2026-06-27T21:00:00Z", venue_city: "New York, USA", showing: true },
  { match_number: 68, round: "group_stage", group_name: "L", team_a: "Croatia", team_b: "Ghana", teams_confirmed: true, kick_off_at: "2026-06-27T21:00:00Z", venue_city: "Philadelphia, USA", showing: true },
  { match_number: 69, round: "group_stage", group_name: "J", team_a: "Algeria", team_b: "Austria", teams_confirmed: true, kick_off_at: "2026-06-28T02:00:00Z", venue_city: "Kansas City, USA", showing: false },
  { match_number: 70, round: "group_stage", group_name: "J", team_a: "Jordan", team_b: "Argentina", teams_confirmed: true, kick_off_at: "2026-06-28T02:00:00Z", venue_city: "Dallas, USA", showing: false },
  { match_number: 71, round: "group_stage", group_name: "K", team_a: "Colombia", team_b: "Portugal", teams_confirmed: true, kick_off_at: "2026-06-27T23:30:00Z", venue_city: "Miami, USA", showing: false },
  { match_number: 72, round: "group_stage", group_name: "K", team_a: "Congo DR", team_b: "Uzbekistan", teams_confirmed: true, kick_off_at: "2026-06-27T23:30:00Z", venue_city: "Atlanta, USA", showing: false },
  { match_number: 73, round: "round_of_32", group_name: null, team_a: "South Africa", team_b: "Canada", teams_confirmed: true, kick_off_at: "2026-06-28T19:00:00Z", venue_city: "Los Angeles, USA", showing: true },
  { match_number: 74, round: "round_of_32", group_name: null, team_a: "Germany", team_b: "Paraguay", teams_confirmed: true, kick_off_at: "2026-06-29T20:30:00Z", venue_city: "Boston, USA", showing: true },
  { match_number: 75, round: "round_of_32", group_name: null, team_a: "Netherlands", team_b: "Morocco", teams_confirmed: true, kick_off_at: "2026-06-30T01:00:00Z", venue_city: "Monterrey, Mexico", showing: false },
  { match_number: 76, round: "round_of_32", group_name: null, team_a: "Brazil", team_b: "Japan", teams_confirmed: true, kick_off_at: "2026-06-29T17:00:00Z", venue_city: "Houston, USA", showing: true },
  { match_number: 77, round: "round_of_32", group_name: null, team_a: "France", team_b: "Sweden", teams_confirmed: true, kick_off_at: "2026-06-30T21:00:00Z", venue_city: "New York, USA", showing: true },
  { match_number: 78, round: "round_of_32", group_name: null, team_a: "Ivory Coast", team_b: "Norway", teams_confirmed: true, kick_off_at: "2026-06-30T17:00:00Z", venue_city: "Dallas, USA", showing: true },
  { match_number: 79, round: "round_of_32", group_name: null, team_a: "Mexico", team_b: "Ecuador", teams_confirmed: true, kick_off_at: "2026-07-01T01:00:00Z", venue_city: "Mexico City, Mexico", showing: false },
  { match_number: 80, round: "round_of_32", group_name: null, team_a: "England", team_b: "DR Congo", teams_confirmed: true, kick_off_at: "2026-07-01T16:00:00Z", venue_city: "Atlanta, USA", showing: true },
  { match_number: 81, round: "round_of_32", group_name: null, team_a: "United States", team_b: "Bosnia and Herzegovina", teams_confirmed: true, kick_off_at: "2026-07-02T00:00:00Z", venue_city: "San Francisco Bay Area, USA", showing: false },
  { match_number: 82, round: "round_of_32", group_name: null, team_a: "Belgium", team_b: "Senegal", teams_confirmed: true, kick_off_at: "2026-07-01T20:00:00Z", venue_city: "Seattle, USA", showing: true },
  { match_number: 83, round: "round_of_32", group_name: null, team_a: "Portugal", team_b: "Croatia", teams_confirmed: true, kick_off_at: "2026-07-02T23:00:00Z", venue_city: "Toronto, Canada", showing: false },
  { match_number: 84, round: "round_of_32", group_name: null, team_a: "Spain", team_b: "Austria", teams_confirmed: true, kick_off_at: "2026-07-02T19:00:00Z", venue_city: "Los Angeles, USA", showing: true },
  { match_number: 85, round: "round_of_32", group_name: null, team_a: "Switzerland", team_b: "Algeria", teams_confirmed: true, kick_off_at: "2026-07-03T03:00:00Z", venue_city: "Vancouver, Canada", showing: false },
  { match_number: 86, round: "round_of_32", group_name: null, team_a: "Argentina", team_b: "Cape Verde", teams_confirmed: true, kick_off_at: "2026-07-03T22:00:00Z", venue_city: "Miami, USA", showing: true },
  { match_number: 87, round: "round_of_32", group_name: null, team_a: "Colombia", team_b: "Ghana", teams_confirmed: true, kick_off_at: "2026-07-04T01:30:00Z", venue_city: "Kansas City, USA", showing: false },
  { match_number: 88, round: "round_of_32", group_name: null, team_a: "Australia", team_b: "Egypt", teams_confirmed: true, kick_off_at: "2026-07-03T18:00:00Z", venue_city: "Dallas, USA", showing: true },
  { match_number: 89, round: "round_of_16", group_name: null, team_a: "W74", team_b: "W77", teams_confirmed: false, kick_off_at: "2026-07-04T21:00:00Z", venue_city: "Philadelphia, USA", showing: true },
  { match_number: 90, round: "round_of_16", group_name: null, team_a: "W73", team_b: "W75", teams_confirmed: false, kick_off_at: "2026-07-04T17:00:00Z", venue_city: "Houston, USA", showing: true },
  { match_number: 91, round: "round_of_16", group_name: null, team_a: "W76", team_b: "W78", teams_confirmed: false, kick_off_at: "2026-07-05T20:00:00Z", venue_city: "New York, USA", showing: true },
  { match_number: 92, round: "round_of_16", group_name: null, team_a: "W79", team_b: "W80", teams_confirmed: false, kick_off_at: "2026-07-06T00:00:00Z", venue_city: "Mexico City, Mexico", showing: false },
  { match_number: 93, round: "round_of_16", group_name: null, team_a: "W83", team_b: "W84", teams_confirmed: false, kick_off_at: "2026-07-06T19:00:00Z", venue_city: "Dallas, USA", showing: true },
  { match_number: 94, round: "round_of_16", group_name: null, team_a: "W81", team_b: "W82", teams_confirmed: false, kick_off_at: "2026-07-07T00:00:00Z", venue_city: "Seattle, USA", showing: false },
  { match_number: 95, round: "round_of_16", group_name: null, team_a: "W86", team_b: "W88", teams_confirmed: false, kick_off_at: "2026-07-07T16:00:00Z", venue_city: "Atlanta, USA", showing: true },
  { match_number: 96, round: "round_of_16", group_name: null, team_a: "W85", team_b: "W87", teams_confirmed: false, kick_off_at: "2026-07-07T20:00:00Z", venue_city: "Vancouver, Canada", showing: true },
  { match_number: 97, round: "quarter_final", group_name: null, team_a: "W89", team_b: "W90", teams_confirmed: false, kick_off_at: "2026-07-09T20:00:00Z", venue_city: "Boston, USA", showing: true },
  { match_number: 98, round: "quarter_final", group_name: null, team_a: "W93", team_b: "W94", teams_confirmed: false, kick_off_at: "2026-07-10T19:00:00Z", venue_city: "Los Angeles, USA", showing: true },
  { match_number: 99, round: "quarter_final", group_name: null, team_a: "W91", team_b: "W92", teams_confirmed: false, kick_off_at: "2026-07-11T21:00:00Z", venue_city: "Miami, USA", showing: true },
  { match_number: 100, round: "quarter_final", group_name: null, team_a: "W95", team_b: "W96", teams_confirmed: false, kick_off_at: "2026-07-12T01:00:00Z", venue_city: "Kansas City, USA", showing: false },
  { match_number: 101, round: "semi_final", group_name: null, team_a: "W97", team_b: "W98", teams_confirmed: false, kick_off_at: "2026-07-14T19:00:00Z", venue_city: "Dallas, USA", showing: true },
  { match_number: 102, round: "semi_final", group_name: null, team_a: "W99", team_b: "W100", teams_confirmed: false, kick_off_at: "2026-07-15T19:00:00Z", venue_city: "Atlanta, USA", showing: true },
  { match_number: 103, round: "third_place", group_name: null, team_a: "RU101", team_b: "RU102", teams_confirmed: false, kick_off_at: "2026-07-18T21:00:00Z", venue_city: "Miami, USA", showing: true },
  { match_number: 104, round: "final", group_name: null, team_a: "W101", team_b: "W102", teams_confirmed: false, kick_off_at: "2026-07-19T19:00:00Z", venue_city: "New York, USA", showing: true },
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
        "Team A".padEnd(26),
        "Team B".padEnd(26),
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
          r.team_a.padEnd(26),
          r.team_b.padEnd(26),
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
