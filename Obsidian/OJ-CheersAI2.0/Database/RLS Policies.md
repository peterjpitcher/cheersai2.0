---
title: RLS Policies
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/database
related:
  - "[[Schema]]"
  - "[[Auth & Security]]"
---

← [[_Index]] / [[_Database MOC]]

# RLS Policies

RLS was enabled across all tables in migration `20250212150000_enable_rls.sql` with further hardening in `20250216160000_security_hardening.sql`.

## General Pattern

All user-facing tables follow the same pattern: users can only read and write rows where `account_id = auth.uid()` (or the resolved `account_id` from `app_metadata`).

## Account Upsert

`20250213104500_allow_account_insert.sql` added an INSERT policy on `accounts` to allow authenticated users to insert their own row — required for the `ensureAccountRecord()` function on first login.

## Media Storage Policy

`20250213120000_media_storage_policy.sql` configured the `media-assets` Supabase Storage bucket with policies allowing authenticated users to upload and read only their own files (paths prefixed with their `account_id`).

## Service Role Bypass

The service-role client used in:
- Cron jobs (`/api/cron/*`)
- OAuth state management (`oauth_states` table)
- Publish queue operations
- Admin backfill scripts

...bypasses all RLS policies intentionally. All service-role usage is documented with a comment in the relevant file.

> [!WARNING]
> If you add a new data operation that runs outside a user context (cron, webhook, background job), you MUST use the service-role client and document why. Never disable RLS on a table — create a proper service-role path instead.
