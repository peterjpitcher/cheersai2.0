-- Event artwork coverage in the Anchor management app (AMS project
-- tfcasgxopxegwrabvwat). Read-only.
--
-- Committed because the numbers in tasks/SPEC-event-artwork-import.md drove a
-- design decision: at the time of writing, four of sixteen upcoming events had
-- artwork, which is why partial and missing artwork is the common path in the
-- import rather than an edge case. Re-run before release; if coverage has since
-- become the norm, some of that defensiveness is worth revisiting.
--
-- The two blocks are on different bases on purpose. Mixing an all-time count
-- with an upcoming-events count is how "35 events have a square" turns into a
-- claim about next month's diary.

-- 1. Upcoming events, by variant.
select
  count(*)                                                          as upcoming_events,
  count(*) filter (where hero_image_url      is not null)           as with_square,
  count(*) filter (where story_image_url     is not null)           as with_story,
  count(*) filter (where landscape_image_url is not null)           as with_landscape,
  count(*) filter (where social_image_url    is not null)           as with_social,
  count(*) filter (where print_poster_url    is not null)           as with_print,
  count(*) filter (where hero_image_url is null and story_image_url is null
                     and landscape_image_url is null)               as with_nothing_importable
from public.events
where date >= current_date;

-- 2. All time, from the metadata rows rather than the cache columns.
--
-- These differ from block 1 on purpose: an event with no event_images row can
-- still show a hero_image_url, because a new event inherits its category's
-- default image verbatim. That URL is category stock, not artwork designed for
-- the event, which is why the API marks it `inherited`.
select
  image_type,
  count(*)                  as rows,
  count(distinct event_id)  as events
from public.event_images
group by image_type
order by image_type;

-- 3. How often a kit looks part-updated, which is what the import's mixed-kit
--    warning is calibrated against. Variants are uploaded one at a time, so a
--    wide spread means someone replaced artwork across more than one sitting.
select
  event_id,
  count(*)                                          as variants,
  max(updated_at) - min(updated_at)                 as spread
from public.event_images
where image_type in ('square', 'story', 'landscape')
group by event_id
having count(*) > 1
order by spread desc
limit 20;
