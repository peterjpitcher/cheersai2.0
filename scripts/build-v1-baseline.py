#!/usr/bin/env python3
"""Generate supabase/baseline/v1_baseline.sql from supabase/remote-v1-backup.sql.

WHY THIS EXISTS
---------------
The v2 migration chain assumes a set of v1 database objects already exist (e.g.
tables `ad_sets`, `ads`, `campaigns`, function `advisory_lock_fixture`, view
`publish_jobs_with_variant`). On the real/prod database they do — they were created
by v1 and were never re-created by a migration. But a from-scratch rebuild
(`supabase start` in CI, or `supabase db reset` locally) only runs the migrations,
so those objects never exist and the chain aborts at the first bare reference
(`ALTER FUNCTION public.advisory_lock_fixture ...` in 20260527063216).

This script extracts ONLY the "v1-only" objects — the ones the v1 backup creates but
NO migration creates — into a single baseline file. CI and `npm run db:rebuild` stage
that file as migrations/20260519230001_v1_baseline.sql (immediately after the v1->v2
bridge, before the first migration that references a v1 object). The baseline is NOT a
committed migration, so prod's migration history and `supabase db push` are untouched.

The "v1-only" set is computed dynamically (dump objects minus migration objects), so it
self-corrects if the backup or migrations change. Re-run after changing either:
    python3 scripts/build-v1-baseline.py

Note: supabase/remote-v1-backup.sql is gitignored (it is a full prod dump). The
GENERATED baseline is committed and schema-only (no data rows are emitted).
"""
import re, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = os.path.join(ROOT, "supabase", "remote-v1-backup.sql")
OUT  = os.path.join(ROOT, "supabase", "baseline", "v1_baseline.sql")
MIGR = sorted(glob.glob(os.path.join(ROOT, "supabase", "migrations", "*.sql")))
STAGED_MARK = "v1_baseline"          # ignore the staged copy when scanning migrations
SLOT = "20260519230001_v1_baseline.sql"

def norm(name: str) -> str:
    name = name.strip().strip('"')
    if "." in name:
        name = name.split(".")[-1]
    return name.strip().strip('"').lower()

# --- which objects does each SQL file CREATE? (line-anchored; dumps emit DDL at col 0) ---
RE_TABLE = re.compile(r'^\s*CREATE TABLE (?:IF NOT EXISTS )?(\S+)', re.I | re.M)
RE_FUNC  = re.compile(r'^\s*CREATE (?:OR REPLACE )?FUNCTION (\S+?)\(', re.I | re.M)
RE_VIEW  = re.compile(r'^\s*CREATE (?:OR REPLACE )?(?:MATERIALIZED )?VIEW (\S+)', re.I | re.M)

def created(text):
    return ({norm(x) for x in RE_TABLE.findall(text)},
            {norm(x) for x in RE_FUNC.findall(text)},
            {norm(x) for x in RE_VIEW.findall(text)})

with open(DUMP, encoding="utf-8", errors="replace") as f:
    dump_text = f.read()
d_tables, d_funcs, d_views = created(dump_text)

m_tables, m_funcs, m_views = set(), set(), set()
for mp in MIGR:
    if STAGED_MARK in os.path.basename(mp):
        continue
    t, fn, v = created(open(mp, encoding="utf-8", errors="replace").read())
    m_tables |= t; m_funcs |= fn; m_views |= v

V1_TABLES = d_tables - m_tables
V1_FUNCS  = d_funcs - m_funcs
V1_VIEWS  = d_views - m_views

# --- statement splitter: respects '...' strings, $tag$...$tag$ bodies, -- comments ---
def split_statements(sql: str):
    stmts, buf = [], []
    i, n = 0, len(sql)
    in_s = False
    dollar = None
    while i < n:
        ch = sql[i]
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar); i += len(dollar); dollar = None; continue
            buf.append(ch); i += 1; continue
        if in_s:
            if ch == "'" and sql[i+1:i+2] == "'":
                buf.append("''"); i += 2; continue
            if ch == "'":
                in_s = False
            buf.append(ch); i += 1; continue
        if sql[i:i+2] == "--":
            j = sql.find("\n", i)
            if j == -1: j = n
            buf.append(sql[i:j]); i = j; continue
        if ch == "'":
            in_s = True; buf.append(ch); i += 1; continue
        m = re.match(r"\$[A-Za-z0-9_]*\$", sql[i:])
        if m:
            dollar = m.group(0); buf.append(dollar); i += len(dollar); continue
        if ch == ";":
            buf.append(";"); stmts.append("".join(buf).strip()); buf = []; i += 1; continue
        buf.append(ch); i += 1
    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)
    out = []
    for s in stmts:
        if s and not all(l.strip().startswith("--") or not l.strip() for l in s.splitlines()):
            out.append(s)
    return out

def lead(stmt: str) -> str:
    return "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()

P = {
    "create_table": re.compile(r'^CREATE TABLE (?:IF NOT EXISTS )?(\S+)', re.I),
    "create_func":  re.compile(r'^CREATE (?:OR REPLACE )?FUNCTION (\S+?)\(', re.I),
    "create_view":  re.compile(r'^CREATE (?:OR REPLACE )?(?:MATERIALIZED )?VIEW (\S+)', re.I),
    "create_index": re.compile(r'^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?\S+ ON (?:ONLY )?(\S+)', re.I),
    "create_trig":  re.compile(r'^CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER .+? ON (?:ONLY )?(\S+)', re.I | re.S),
    "create_pol":   re.compile(r'^CREATE POLICY .+? ON (?:ONLY )?(\S+)', re.I | re.S),
    "alter_table":  re.compile(r'^ALTER TABLE (?:ONLY )?(\S+)', re.I),
}
NOISE = re.compile(
    r'^(GRANT|REVOKE|COMMENT ON|SET |SELECT pg_catalog\.set_config|CREATE SCHEMA|'
    r'CREATE EXTENSION|INSERT INTO|COPY|ALTER DEFAULT PRIVILEGES|'
    r'ALTER FUNCTION \S+ OWNER|ALTER TABLE \S+ OWNER)', re.I)

kt = lambda t: norm(t) in V1_TABLES
kf = lambda f: norm(f) in V1_FUNCS
kv = lambda v: norm(v) in V1_VIEWS

buckets = {k: [] for k in ("func","table","default","constraint","index","rls","policy","trigger","view")}
dropped = {"noise": 0, "non_v1": 0}
unclassified = []

for stmt in split_statements(dump_text):
    s = lead(stmt)
    if not s:
        continue
    if s.upper().startswith("ALTER") and "OWNER TO" in s.upper():
        dropped["noise"] += 1; continue
    if NOISE.match(s):
        dropped["noise"] += 1; continue
    m = P["create_table"].match(s)
    if m:
        buckets["table"].append(stmt) if kt(m.group(1)) else dropped.__setitem__("non_v1", dropped["non_v1"]+1)
        continue
    m = P["create_func"].match(s)
    if m:
        buckets["func"].append(stmt) if kf(m.group(1)) else dropped.__setitem__("non_v1", dropped["non_v1"]+1)
        continue
    m = P["create_view"].match(s)
    if m:
        buckets["view"].append(stmt) if kv(m.group(1)) else dropped.__setitem__("non_v1", dropped["non_v1"]+1)
        continue
    m = P["create_index"].match(s)
    if m:
        buckets["index"].append(stmt) if kt(m.group(1)) else dropped.__setitem__("non_v1", dropped["non_v1"]+1)
        continue
    m = P["create_trig"].match(s)
    if m:
        buckets["trigger"].append(stmt) if kt(m.group(1)) else dropped.__setitem__("non_v1", dropped["non_v1"]+1)
        continue
    m = P["create_pol"].match(s)
    if m:
        buckets["policy"].append(stmt) if kt(m.group(1)) else dropped.__setitem__("non_v1", dropped["non_v1"]+1)
        continue
    m = P["alter_table"].match(s)
    if m:
        if not kt(m.group(1)):
            dropped["non_v1"] += 1; continue
        up = s.upper()
        if "ROW LEVEL SECURITY" in up:
            buckets["rls"].append(stmt)
        elif "ADD CONSTRAINT" in up:
            buckets["constraint"].append(stmt)
        else:
            buckets["default"].append(stmt)
        continue
    unclassified.append(s.replace("\n", " ")[:110])

# --- Reconcile migration-owned tables that v1-only VIEWs read v1-era columns from.
# e.g. publish_jobs is created by a v2 migration WITHOUT the v1 columns (variant_id,
# placement, …) that prod still has from its pre-existing v1 table, so the v1-only view
# cannot build on a fresh rebuild. Re-add exactly the columns the view references, typed
# from the dump, with IF NOT EXISTS (already-present columns are skipped; prod is untouched
# because the baseline never runs there).
def _dump_table_cols(table):
    m = re.search(r'CREATE TABLE[^;]*?"?public"?\."?' + re.escape(table) + r'"?\s*\((.*?)\n\);',
                  dump_text, re.I | re.S)
    cols = {}
    if not m:
        return cols
    for line in m.group(1).splitlines():
        line = line.strip().rstrip(",")
        if not line or line.upper().startswith(("CONSTRAINT","PRIMARY KEY","FOREIGN KEY","UNIQUE","CHECK")):
            continue
        cm = re.match(r'"?(\w+)"?\s+(.*)', line)
        if not cm:
            continue
        typ = re.split(r'\s+(?:DEFAULT|NOT NULL|GENERATED|COLLATE|REFERENCES)\b',
                       cm.group(2), flags=re.I)[0].strip()
        cols[cm.group(1).lower()] = typ
    return cols

reconcile = []
for vstmt in buckets["view"]:
    alias_to_tbl = {a.lower(): t.lower() for t, a in
                    re.findall(r'(?:FROM|JOIN)\s+\(?\s*"?public"?\."?(\w+)"?\s+"?(\w+)"?', vstmt, re.I)}
    need = {}
    for alias, col in re.findall(r'"(\w+)"\."(\w+)"', vstmt):
        tbl = alias_to_tbl.get(alias.lower())
        if tbl and tbl not in V1_TABLES:          # only migration-owned source tables
            need.setdefault(tbl, set()).add(col.lower())
    for tbl in sorted(need):
        dcols = _dump_table_cols(tbl)
        for col in sorted(need[tbl]):
            if col in dcols:
                reconcile.append(f'ALTER TABLE "public"."{tbl}" ADD COLUMN IF NOT EXISTS "{col}" {dcols[col]};')
buckets["reconcile"] = reconcile

order = ["func","table","default","constraint","index","rls","policy","trigger","reconcile","view"]
header = f"""-- supabase/baseline/v1_baseline.sql
-- AUTO-GENERATED by scripts/build-v1-baseline.py from supabase/remote-v1-backup.sql
-- (the v1 pre-v2 database snapshot). Contains ONLY the v1 objects that NO migration
-- creates, so a from-scratch rebuild can apply the v2 migration chain.
--
-- This is NOT a committed migration. CI (.github/workflows/ci.yml) and the local
-- `npm run db:rebuild` script stage it as
--   supabase/migrations/{SLOT}
-- (immediately after the v1->v2 bridge, before the first migration that references a
-- v1 object), then run `supabase start` / `supabase db reset`. It runs on a FRESH
-- database only, so it intentionally uses plain DDL with no idempotency guards.
--
-- Do NOT edit by hand and do NOT commit the staged migrations/ copy (it is gitignored).
-- Regenerate with: python3 scripts/build-v1-baseline.py

"""

SECTION = {
    "func": "functions", "table": "tables", "default": "column defaults",
    "constraint": "constraints", "index": "indexes", "rls": "row level security",
    "policy": "policies", "trigger": "triggers",
    "reconcile": "reconcile migration-owned columns the v1 view needs (IF NOT EXISTS; no-op on prod)",
    "view": "views",
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(header)
    for cat in order:
        if not buckets[cat]:
            continue
        f.write(f"-- ===== {SECTION[cat]} =====\n")
        for stmt in buckets[cat]:
            f.write(stmt.rstrip())
            if not stmt.rstrip().endswith(";"):
                f.write(";")
            f.write("\n\n")

print("WROTE", os.path.relpath(OUT, ROOT))
print(f"v1-only computed: {len(V1_TABLES)} tables, {len(V1_FUNCS)} funcs, {len(V1_VIEWS)} view(s)")
for cat in order:
    print(f"  {cat:11s}: {len(buckets[cat])}")
print("dropped:", dropped, "| unclassified:", len(unclassified))
for u in unclassified:
    print("   ?", u)
