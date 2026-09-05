/**
 * Guards what the public anon key can reach in the live database.
 *
 * The reviewed state lives in supabase/anon-access-allowlist.ts. This file reads
 * the live catalogue and fails, naming the object, when the database grants anon
 * anything that file does not allow.
 *
 * HOW TO RUN IT AGAINST A REAL PROJECT
 *   SUPABASE_DB_URL='postgresql://...' npx vitest run tests/anon-access.test.ts
 *
 *   The connection string is the direct Postgres URL, or the pooler URL, from the
 *   Supabase dashboard under Project Settings, Database. DATABASE_URL is accepted
 *   as an alias. A read-only role is enough and is preferable.
 *
 * WITHOUT A CONNECTION STRING IT SKIPS, ON PURPOSE
 *   `npm test` must stay runnable offline and must not need production
 *   credentials, so the live check is opt-in. It says out loud that it skipped
 *   and why, because a silent skip is indistinguishable from a pass. Nothing else
 *   in `npm test` touches a database.
 *
 *   The rest of this file is pure and always runs, so the comparison rules and
 *   the tenant-boundary rule are proven even when the live check does not run.
 *
 * IT CANNOT CHANGE ANYTHING
 *   One SELECT, and the session is forced read-only through PGOPTIONS, so a
 *   mistake here cannot write to the database it is inspecting. psql is used
 *   rather than a driver because this repository has no Postgres client in its
 *   dependencies and adding one to run a single read is not worth the supply
 *   chain.
 */

import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  ANON_ALLOWLIST,
  ANON_CATALOGUE_QUERY,
  ANON_OPEN_ITEMS,
  ANON_POLICY_OPEN_ITEMS,
  NEVER_ALLOWLIST,
  describeAnonAccessFindings,
  diffAnonAccess,
  type AnonCatalogueEntry,
} from '../supabase/anon-access-allowlist';

// ---------------------------------------------------------------------------
// Reaching the live database, or explaining why we are not going to.
// ---------------------------------------------------------------------------

const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? '';

function psqlAvailable(): boolean {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

/**
 * Why the live check is not running, or `false` when it is. The reason ends up
 * in the test title and on stderr, so it cannot be mistaken for a pass.
 */
function liveCheckSkipReason(): string | false {
  if (!connectionString) {
    return 'no database connection configured. Set SUPABASE_DB_URL (or DATABASE_URL) to the project Postgres URL to run the live anon-grant check. Skipping is expected offline and in CI.';
  }
  if (!psqlAvailable()) {
    return 'SUPABASE_DB_URL is set but psql is not on PATH, so the live catalogue cannot be read. Install the Postgres client (brew install libpq, or apt-get install postgresql-client).';
  }
  return false;
}

const skipReason = liveCheckSkipReason();

if (skipReason) {
  console.warn(`[anon-access] live anon-grant check SKIPPED: ${skipReason}`);
}

function readLiveCatalogue(): AnonCatalogueEntry[] {
  const result = spawnSync(
    'psql',
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', ANON_CATALOGUE_QUERY, connectionString],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // Belt and braces: this session cannot write, whatever the query says.
        PGOPTIONS: '-c default_transaction_read_only=on',
        PGCONNECT_TIMEOUT: '15',
      },
    },
  );

  if (result.error) {
    throw new Error(`could not run psql: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `psql exited ${result.status} while reading the anon catalogue.\n${result.stderr?.trim() ?? ''}`,
    );
  }

  const output = result.stdout.trim();
  if (!output) {
    throw new Error('psql returned no rows for the anon catalogue query, which should be impossible');
  }

  return JSON.parse(output) as AnonCatalogueEntry[];
}

// ---------------------------------------------------------------------------
// The live check.
// ---------------------------------------------------------------------------

describe('anon access to the live database', () => {
  const title = skipReason
    ? `anon can reach nothing beyond supabase/anon-access-allowlist.ts (SKIPPED: ${skipReason})`
    : 'anon can reach nothing beyond supabase/anon-access-allowlist.ts';

  it.skipIf(skipReason !== false)(title, { timeout: 60_000 }, () => {
    const reachable = readLiveCatalogue();

    console.info(
      `[anon-access] live catalogue: anon can reach ${reachable.length} object(s) in schema public`,
    );

    const { findings, stale } = diffAnonAccess(reachable);

    for (const key of stale) {
      console.info(
        `[anon-access] allowlist entry no longer reachable by anon: ${key}. The database got tighter; trim the allowlist.`,
      );
    }

    if (findings.length > 0) {
      throw new Error(describeAnonAccessFindings(findings));
    }

    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rules about the allowlist itself. These need no database and always run.
// ---------------------------------------------------------------------------

describe('the allowlist file', () => {
  it('never allowlists an object that crosses the tenant boundary', () => {
    const banned = new Set(NEVER_ALLOWLIST);

    const offenders = ANON_ALLOWLIST.filter((entry) => {
      const bareName = entry.kind === 'function' ? entry.name.split('(')[0] : entry.name;
      return banned.has(bareName);
    }).map((entry) => `${entry.kind} ${entry.name}`);

    expect(
      offenders,
      `These define or cross the tenant boundary and must never be allowlisted for anon: ${offenders.join(', ')}. This is a multi-tenant database. If the live database grants one of them, write a migration that revokes it from PUBLIC and anon. Do not add it here.`,
    ).toEqual([]);
  });

  it('records a reason and at least one privilege for every entry', () => {
    for (const entry of ANON_ALLOWLIST) {
      expect(entry.why.trim().length, `${entry.kind} ${entry.name} has no reason recorded`).toBeGreaterThan(0);
      expect(
        entry.privileges.length,
        `${entry.kind} ${entry.name} is allowlisted with no privileges, so it should be removed`,
      ).toBeGreaterThan(0);
    }
  });

  it('never lists the same object twice', () => {
    const keys = ANON_ALLOWLIST.map((entry) => `${entry.kind} ${entry.name}`);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it('never both allowlists and opens an item, because that would bless it', () => {
    const allowed = new Set(ANON_ALLOWLIST.map((entry) => `${entry.kind} ${entry.name}`));
    for (const item of [...ANON_OPEN_ITEMS, ...ANON_POLICY_OPEN_ITEMS]) {
      expect(
        allowed.has(`${item.kind} ${item.name}`),
        `${item.kind} ${item.name} is recorded as an unresolved open item and must not appear in ANON_ALLOWLIST`,
      ).toBe(false);
    }
  });

  it('records a reason for every open item', () => {
    for (const item of [...ANON_OPEN_ITEMS, ...ANON_POLICY_OPEN_ITEMS]) {
      expect(item.why.trim().length, `${item.kind} ${item.name} has no reason recorded`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The comparison rules, proven with fixtures so they hold even when the live
// check skips. Without these, an offline run proves nothing at all.
// ---------------------------------------------------------------------------

describe('diffAnonAccess', () => {
  const fixtureAllowlist = [
    { kind: 'table' as const, name: 'campaigns', privileges: ['SELECT'], why: 'fixture' },
  ];

  it('passes when the live state matches the allowlist', () => {
    const { findings, stale } = diffAnonAccess(
      [{ kind: 'table', name: 'campaigns', privileges: ['SELECT'] }],
      fixtureAllowlist,
      [],
    );

    expect(findings).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('flags, by name, an object anon reaches that is not allowlisted', () => {
    const { findings } = diffAnonAccess(
      [
        { kind: 'table', name: 'campaigns', privileges: ['SELECT'] },
        { kind: 'table', name: 'token_vault', privileges: ['SELECT'] },
      ],
      fixtureAllowlist,
      [],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toBe('unlisted');
    expect(findings[0].name).toBe('token_vault');
    expect(describeAnonAccessFindings(findings)).toContain('token_vault');
  });

  it('flags a listed object whose privileges have widened', () => {
    const { findings } = diffAnonAccess(
      [{ kind: 'table', name: 'campaigns', privileges: ['SELECT', 'UPDATE', 'DELETE'] }],
      fixtureAllowlist,
      [],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toBe('widened');
    expect(findings[0].extraPrivileges).toEqual(['DELETE', 'UPDATE']);
  });

  it('flags an extension that has grown more anon-executable functions', () => {
    const { findings } = diffAnonAccess(
      [{ kind: 'extension', name: 'btree_gist', privileges: ['EXECUTE'], objects: 200 }],
      [
        {
          kind: 'extension',
          name: 'btree_gist',
          privileges: ['EXECUTE'],
          objects: 188,
          why: 'fixture',
        },
      ],
      [],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toBe('grew');
    expect(describeAnonAccessFindings(findings)).toContain('200');
  });

  it('does not flag an extension that has shrunk', () => {
    const { findings } = diffAnonAccess(
      [{ kind: 'extension', name: 'btree_gist', privileges: ['EXECUTE'], objects: 12 }],
      [
        {
          kind: 'extension',
          name: 'btree_gist',
          privileges: ['EXECUTE'],
          objects: 188,
          why: 'fixture',
        },
      ],
      [],
    );

    expect(findings).toEqual([]);
  });

  it('does not let a function overload hide behind a sibling with the same name', () => {
    const { findings } = diffAnonAccess(
      [
        { kind: 'function', name: 'f(a uuid)', privileges: ['EXECUTE'] },
        { kind: 'function', name: 'f(a uuid, b uuid)', privileges: ['EXECUTE'] },
      ],
      [{ kind: 'function', name: 'f(a uuid)', privileges: ['EXECUTE'], why: 'fixture' }],
      [],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('f(a uuid, b uuid)');
  });

  it('still fails on a known open item, but says it is known', () => {
    const { findings } = diffAnonAccess(
      [{ kind: 'function', name: 'stray(x uuid)', privileges: ['EXECUTE'] }],
      [],
      [{ kind: 'function', name: 'stray(x uuid)', why: 'reviewed, revoke pending an owner decision' }],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].knownOpenItem).toBe('reviewed, revoke pending an owner decision');
    expect(describeAnonAccessFindings(findings)).toContain('reviewed, revoke pending an owner decision');
  });

  it('reports an allowlist entry the database no longer grants, without failing', () => {
    const { findings, stale } = diffAnonAccess([], fixtureAllowlist, []);

    expect(findings).toEqual([]);
    expect(stale).toEqual(['table campaigns']);
  });
});
