-- tournaments table
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  base_image_square_id uuid references public.media_assets (id) on delete set null,
  base_image_story_id uuid references public.media_assets (id) on delete set null,
  house_rules_text text check (char_length(house_rules_text) <= 200),
  post_template text not null check (char_length(post_template) <= 500),
  platforms text[] not null default '{instagram,facebook}',
  post_lead_hours int not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tournaments add constraint tournaments_account_slug_unique
  unique (account_id, slug);

create index idx_tournaments_account on public.tournaments (account_id);

-- RLS
alter table public.tournaments enable row level security;

create policy "Tournaments accessible by account owner"
  on public.tournaments for all
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- tournament_fixtures table
create table if not exists public.tournament_fixtures (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  match_number int not null,
  round text not null check (round in (
    'group_stage', 'round_of_32', 'round_of_16',
    'quarter_final', 'semi_final', 'third_place', 'final'
  )),
  group_name text,
  team_a text not null check (char_length(team_a) <= 50),
  team_b text not null check (char_length(team_b) <= 50),
  teams_confirmed boolean not null default false,
  kick_off_at timestamptz not null,
  venue_city text,
  showing boolean not null default false,
  showing_note text,
  booking_url text check (booking_url is null or booking_url like 'https://%'),
  content_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tournament_fixtures add constraint fixtures_tournament_match_unique
  unique (tournament_id, match_number);

create index idx_fixtures_tournament_filter
  on public.tournament_fixtures (tournament_id, showing, teams_confirmed);

create index idx_fixtures_tournament_kickoff
  on public.tournament_fixtures (tournament_id, kick_off_at);

-- RLS via tournament ownership
alter table public.tournament_fixtures enable row level security;

create policy "Fixtures accessible via tournament account"
  on public.tournament_fixtures for all
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_fixtures.tournament_id
        and t.account_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_fixtures.tournament_id
        and t.account_id = auth.uid()
    )
  );

-- updated_at triggers
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tournaments_updated_at
  before update on public.tournaments
  for each row execute function public.set_updated_at();

create trigger tournament_fixtures_updated_at
  before update on public.tournament_fixtures
  for each row execute function public.set_updated_at();
