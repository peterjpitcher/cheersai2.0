alter table public.content_items
  add column if not exists placement text not null default 'feed'
    check (placement in ('feed','story'));

update public.content_items set placement = 'feed' where placement is null;

alter table public.publish_jobs
  add column if not exists placement text not null default 'feed'
    check (placement in ('feed','story'));

update public.publish_jobs set placement = 'feed' where placement is null;

comment on column public.content_items.placement is 'Placement of the content (feed or story)';
comment on column public.publish_jobs.placement is 'Placement of the publish job (feed or story)';
