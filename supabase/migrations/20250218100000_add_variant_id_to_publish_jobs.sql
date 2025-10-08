alter table public.publish_jobs
  add column if not exists variant_id uuid;

update public.publish_jobs pj
set variant_id = sub.id
from (
  select distinct on (cv.content_item_id) cv.content_item_id, cv.id
  from public.content_variants cv
  where cv.content_item_id is not null
  order by cv.content_item_id, cv.updated_at desc, cv.id
) as sub
where pj.variant_id is null
  and sub.content_item_id = pj.content_item_id;

alter table public.publish_jobs
  alter column variant_id set not null;

alter table public.publish_jobs
  add constraint publish_jobs_variant_id_fkey
  foreign key (variant_id) references public.content_variants(id) on delete cascade;

create index if not exists publish_jobs_variant_id_idx on public.publish_jobs (variant_id);

create unique index if not exists publish_jobs_story_unique
  on public.publish_jobs (content_item_id, placement)
  where placement = 'story' and status in ('queued','in_progress');

create or replace view public.publish_jobs_with_variant as
select pj.*, cv.media_ids
from public.publish_jobs pj
join public.content_variants cv on cv.id = pj.variant_id;

create or replace function public.inspect_worker_db_context()
returns table (
  is_replica boolean,
  isolation text,
  txn bigint,
  ts timestamptz
) language sql security definer
as $$
  select
    pg_is_in_recovery() as is_replica,
    current_setting('transaction_isolation') as isolation,
    txid_current() as txn,
    now() as ts;
$$;
