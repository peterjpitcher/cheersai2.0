# Golden Dashboards

This document describes four operational dashboards and the queries/panels to implement them in your monitoring tool (Grafana, Datadog, etc.).

## Publish Success
- Metric: success rate over 30 minutes, broken down by platform and tenant.
- Source: `publishing_history` table.
- Query (Supabase/Postgres):
```sql
select platform,
  count(*)                                     as total,
  sum(case when status = 'published' then 1 else 0 end) as published,
  (sum(case when status = 'published' then 1 else 0 end)::float / greatest(count(*),1)) as success_rate
from publishing_history
where created_at >= now() - interval '30 minutes'
group by 1
order by 4 desc;
```
- Alert: success_rate < 0.95 for 30 minutes.

## Queue Health
- Panels:
  - Jobs by status (`pending`, `processing`, `failed`, `completed`).
  - Age of oldest `pending` item.
  - `queue.reconcile` inserts/updates over time (structured logs) to confirm automatic enqueueing is active.
```sql
select status, count(*) from publishing_queue group by 1;
select extract(epoch from (now() - min(scheduled_for)))/60 as oldest_pending_min from publishing_queue where status = 'pending';
```

## Connection Health
- Panels:
  - Verify pass/fail counts (from `social_connections.verify_status`).
  - Tokens expiring soon: count where `token_expires_at` < now() + 7 days and < 30 days.
```sql
select verify_status, count(*) from social_connections group by 1;
select count(*) filter (where token_expires_at < now() + interval '7 days')  as expiring_7d,
       count(*) filter (where token_expires_at < now() + interval '30 days') as expiring_30d
from social_connections;
```

## App Errors
- Panel: errors by area/op and top `errorCode` over last 24h (from structured logs).
- If using `/api/vitals` + logs, filter `area:webvitals` to observe RUM trends.

## Drill-down via requestId
- All API responses include `requestId` (via `lib/http.ts`). Include this field in logs/alerts so you can drill down to a single request.
