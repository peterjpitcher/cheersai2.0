# Tenant Recognition Diagnostics (Run-and-Reply)

Purpose: confirm why the app returns empty/406 for `/rest/v1/users?id=eq.<uid>` despite a valid session and JWT tenant_id. Please run each step and paste the exact outputs back here.

Notes
- Replace placeholders in ALL CAPS with your values.
- Run SQL steps in the Supabase SQL editor for project `onvnfijtzumtnmgwhiaq`.
- Run REST steps in your terminal. Do NOT share your service role key.

---

1) Confirm current auth uid row (you already did — paste here anyway)
SQL:
```
select id, email, tenant_id
from public.users
where id = '9995ff23-626a-4a59-80b8-d346d91ac424';
```
Expected: A single row with tenant_id `303e9600-7ab9-47e8-9cbf-d8d6c37ea8c8`.

2) Check users RLS is enabled and not FORCEd
SQL:
```
select n.nspname as schema,
       c.relname  as table,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'users';
```
Expected: rls_enabled = t, rls_forced = f.

3) Dump current users policies (full text)
SQL:
```
select p.polname,
       p.polcmd  as cmd,
       pg_get_expr(p.polqual,  c.oid)       as using,
       pg_get_expr(p.polwithcheck, c.oid)   as with_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'users'
order by p.polname, p.polcmd;
```
Expected: A SELECT policy that explicitly allows `id = auth.uid()` (self‑select). If the USING clause only references `tenant_id = get_auth_tenant_id()`, that’s a catch‑22 and will return 0 rows.

4) Verify REST read of your users row (with your current Bearer)
Terminal (replace {PROJECT}, {ANON_KEY}, {BEARER} with the values from your Network tab):
```
curl -s -i \
  -H "apikey: {ANON_KEY}" \
  -H "Authorization: Bearer {BEARER}" \
  -H "accept-profile: public" \
  "https://{PROJECT}.supabase.co/rest/v1/users?select=id,tenant_id&id=eq.9995ff23-626a-4a59-80b8-d346d91ac424"
```
Paste the HTTP status and body. If it’s `200 []`, RLS blocked your row (or bad WHERE). If it’s a single object with id/tenant_id, this endpoint is fine.

5) Verify REST read of membership
```
curl -s -i \
  -H "apikey: {ANON_KEY}" \
  -H "Authorization: Bearer {BEARER}" \
  -H "accept-profile: public" \
  "https://{PROJECT}.supabase.co/rest/v1/user_tenants?select=tenant_id,role,created_at&user_id=eq.9995ff23-626a-4a59-80b8-d346d91ac424&order=role.asc,created_at.asc&limit=1"
```
Expected: `200` with one row for your tenant. If this returns `[]`, membership is being filtered as well.

6) REST call to get_auth_tenant_id() via RPC
```
curl -s -i \
  -X POST \
  -H "apikey: {ANON_KEY}" \
  -H "Authorization: Bearer {BEARER}" \
  -H "Content-Type: application/json" \
  "https://{PROJECT}.supabase.co/rest/v1/rpc/get_auth_tenant_id" \
  -d '{}'
```
Expected: `200` with your tenant UUID when policies are sound. If this returns `null`, the function call is returning nothing under RLS (likely due to a self‑select policy issue).

7) Confirm function definition (you already did — paste again so we align)
SQL:
```
select pg_get_functiondef('public.get_auth_tenant_id'::regproc);
```
Expected: SECURITY DEFINER SQL function selecting `tenant_id from users where id = auth.uid()`.

8) Optional: Count rows seen via REST with Prefer: count=exact
```
curl -s -i \
  -H "apikey: {ANON_KEY}" \
  -H "Authorization: Bearer {BEARER}" \
  -H "accept-profile: public" \
  -H "Prefer: count=exact" \
  "https://{PROJECT}.supabase.co/rest/v1/users?select=id&limit=1"
```
Check `Content-Range` header. If `0-0/*`, no rows are visible under RLS.

---

How we’ll interpret results
- If 2)+3) show RLS enabled and no `id = auth.uid()` in the SELECT policy, that’s the exact cause: your self row is denied, making `get_auth_tenant_id()` and direct `/users` reads return empty.
- If 4) returns `[]` but SQL shows the row exists, it’s RLS (policy misconfigured) or the REST request is sent to a different project (mismatched URL/keys) — compare `{PROJECT}` to `onvnfijtzumtnmgwhiaq`.
- If 6) returns `null`, it confirms `get_auth_tenant_id()` cannot see your users row under RLS.

Once you paste these outputs, we can propose the minimal, safe policy correction (single SQL policy change) with full reasoning.

