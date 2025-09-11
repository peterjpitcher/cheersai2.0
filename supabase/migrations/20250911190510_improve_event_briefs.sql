-- Improve existing event briefs by generating richer, event-aware content
-- - Adds a helper function: public.generate_event_brief(event_id uuid)
-- - Inserts a new versioned brief for each event that already has a brief
--
-- Notes:
-- - Keeps prior versions intact; creates version = max(version)+1 per event.
-- - Uses next scheduled occurrence (if available) for concrete date phrasing.
-- - Tailors recommendations by category and includes Drinkaware note when relevant.

set check_function_bodies = off;
create or replace function public.generate_event_brief(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_slug text;
  v_category text;
  v_alcohol boolean;
  v_date_type text;
  v_fixed date;
  v_notes text;
  v_start date;
  v_end date;
  v_date_phrase text := '';
  v_bucket text;
  v_parts text[] := ARRAY[]::text[];
  v_recs text := '';
  v_assets text := '';
  v_alcohol_note text := '';
  v_text text;
begin
  select e.name, e.slug, e.category, e.alcohol_flag, e.date_type, e.fixed_date, e.notes
    into v_name, v_slug, v_category, v_alcohol, v_date_type, v_fixed, v_notes
  from public.events e
  where e.id = p_event_id;

  -- Next known occurrence window (uses pre-expanded table)
  select o.start_date, o.end_date
    into v_start, v_end
  from public.event_occurrences o
  where o.event_id = p_event_id
    and o.start_date >= current_date
  order by o.start_date asc
  limit 1;

  -- Human-friendly date phrasing
  if v_start is not null then
    if v_end is not null and v_end <> v_start then
      v_date_phrase := 'Next runs from ' || to_char(v_start, 'FMDay DD Month') || ' to ' || to_char(v_end, 'FMDay DD Month YYYY') || '.';
    else
      v_date_phrase := 'Next occurs on ' || to_char(v_start, 'FMDay DD Month YYYY') || '.';
    end if;
  else
    if v_date_type = 'fixed' and v_fixed is not null then
      v_date_phrase := 'Observed annually on ' || to_char(v_fixed, 'FMMonth DD') || ' in the UK.';
    elsif v_date_type = 'multi_day' then
      v_date_phrase := 'Multi‑day event; dates vary — confirm locally.';
    elsif v_date_type = 'recurring' then
      v_date_phrase := 'Follows an annual pattern; confirm exact dates locally.';
    else
      v_date_phrase := 'Dates vary each year; confirm locally.';
    end if;
  end if;

  -- Bucket for copy
  v_bucket := case
    when v_category = 'sports' then 'sports'
    when v_category = 'drink' then 'drinks'
    else coalesce(v_category, 'event')
  end;

  -- Category‑specific recommendations
  v_recs := case v_category
    when 'sports' then 'Match‑day energy: big screens or live score updates, hearty sharers, soft‑drink bundles, group tables, and pre/post‑event windows.'
    when 'drink' then 'Drinks‑led: tasting flights, guest taps or limited pours, low/no options, responsible‑serve cues, and designated driver perks.'
    when 'food' then 'Food‑led: themed set menus, tasting boards, family bundles, pre‑order for groups, and clear dietary notes.'
    when 'seasonal' then 'Seasonal: themed decor, limited‑time specials, cosy ambience, and gifting or takeaway add‑ons.'
    when 'civic' then 'Civic/occasional: family‑friendly hours, strong booking prompts, group menus, accessibility details, and community tie‑ins.'
    else 'Venue‑led: pick a clear hero, keep booking cues obvious, and maintain a warm, inclusive tone.'
  end;

  -- Category‑specific asset suggestions
  v_assets := case v_category
    when 'sports' then 'Crowd moment during kickoff or result; screen vantage; sharer platter close‑up.'
    when 'drink' then 'Hero pour with good head/ice; flight board; low/no alternative shown clearly.'
    when 'food' then 'Plated hero dish; sharing board; clean menu card graphic for stories.'
    when 'seasonal' then 'Themed interior detail; hero special; small lifestyle shot with guests.'
    when 'civic' then 'Family table setup; accessible entrance detail; friendly team welcome shot.'
    else 'Well‑lit hero item; ambience lifestyle; simple menu graphic and alt‑text.'
  end;

  if v_alcohol then
    v_alcohol_note := 'If featuring alcohol, include a responsible‑drinking reminder (DrinkAware.co.uk).';
  end if;

  -- Core summary
  v_parts := array_append(v_parts,
    coalesce(v_name, 'This event') || ' is a UK‑centric ' || v_bucket || ' moment with strong hospitality potential. Use it to drive bookings, footfall, and community engagement. ' || v_date_phrase
  );

  -- Why it matters
  v_parts := array_append(v_parts,
    'Why it matters: High awareness means guests are primed to plan meals out, try specials, and gather with friends and family. Align menu and service to capture intent and encourage advance bookings.'
  );

  -- Activation ideas
  v_parts := array_append(v_parts,
    'Activation ideas: ' || v_recs
  );

  -- Content angles
  v_parts := array_append(v_parts,
    'Content angles: Teaser (what to expect and booking prompt); day‑of (hero dish/drink, venue vibe, last‑minute availability); recap (photos and highlights with a nudge to follow for the next occasion).'
  );

  -- Asset brief
  v_parts := array_append(v_parts,
    'Asset brief: ' || v_assets || ' Prepare concise alt‑text describing each image clearly.'
  );

  if v_alcohol_note <> '' then
    v_parts := array_append(v_parts, v_alcohol_note);
  end if;

  v_text := array_to_string(v_parts, ' ');

  -- Ensure guidance CTA and locality note if under ~240 words
  if array_length(regexp_split_to_array(trim(v_text), '\\s+'), 1) < 240 then
    v_text := rtrim(v_text) || ' Add a friendly, inclusive tone and a clear call to action (book, message, or visit). Keep details accurate and locally relevant, and confirm final dates and times before publishing.';
  end if;

  return trim(v_text);
end;
$$;
comment on function public.generate_event_brief(uuid) is 'Builds a richer, event‑aware brief using event metadata and the next occurrence.';
-- Insert a new versioned brief for every event that already has at least one brief
with targets as (
  select distinct eb.event_id
  from public.event_briefs eb
),
latest as (
  select t.event_id,
         coalesce((select max(b.version) from public.event_briefs b where b.event_id = t.event_id), 0) + 1 as next_version,
         e.alcohol_flag as alcohol_flag
  from targets t
  join public.events e on e.id = t.event_id
)
insert into public.event_briefs (event_id, version, text, constraints_applied, drinkaware_applicable)
select l.event_id,
       l.next_version,
       public.generate_event_brief(l.event_id) as text,
       array['no_emojis','no_links','no_prices']::text[] as constraints_applied,
       (case when l.alcohol_flag or (select e2.category = 'drink' from public.events e2 where e2.id = l.event_id) then true else false end) as drinkaware_applicable
from latest l;
