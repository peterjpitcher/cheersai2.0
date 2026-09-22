# SPEC: Fix Admin > Create brand on the live project

Status: bug fix, 22 September 2026. Complexity 2 (3 files plus a small migration).

## Problem

Creating "Orange Jelly" from Admin failed twice with "Could not create the brand." Postgres logged
`null value in column "id" of relation "accounts" violates not-null constraint` (13:30 and 13:37
UTC). The live `accounts` table still has three leftovers from the one-login, one-account design:

1. `id` has no default (it used to be copied from the auth user id). The repo baseline has
   `DEFAULT gen_random_uuid()`; production drifted.
2. `accounts_email_key` makes the contact email unique, so two brands run by one person cannot
   share it. Only production has this constraint.
3. `auth_user_id` is NOT NULL, and `createBrand` never set it.

`createBrand` was only ever tested against a mocked client, so none of this surfaced.

## Fix

- Migration `20260922150000_accounts_allow_new_brands.sql`: restore the `id` default; drop
  `accounts_email_key`. Nothing looks brands up by email (no code path, function, foreign key or
  view), and the contact email only receives alerts.
- `createBrand` sets `auth_user_id` to the creating admin. The connection-expiry alert
  (`/api/cron/token-health`) emails that login, so new brands keep getting those alerts. Keeping
  the column NOT NULL avoids a wider schema change; `current_account_id()` (unused) reads it with
  `SELECT INTO`, which tolerates two brands sharing an owner.
- `createBrand` logs the database error (Axiom) before returning the generic message, so a failure
  is visible on our side.

## Deploy order and rollback

Apply the migration first; the app change alone still fails on the missing `id` default. Rollback:
revert the app change; restore the default and constraint with the SQL in the migration header
(the constraint only while no two brands share an email).

## Tests

Unit: the insert carries every column the live table requires; a failed insert is logged and not
audited. Database: the verify script checks the default, the dropped constraint, and inserts two
brands with one email inside a rolled-back sub-transaction. Reproduced the production error and
the fix on a production-shaped scratch Postgres 17.
