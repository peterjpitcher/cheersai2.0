#!/usr/bin/env tsx
/*
  Migration discipline checker
  - Flags dangerous operations (DROP COLUMN/TABLE, CREATE INDEX CONCURRENTLY) 
  - Encourages transactional migrations
  - Optionally runs EXPLAIN for queries annotated with `-- EXPLAIN: <select ...>` when DATABASE_URL is provided
*/
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

type Finding = { file: string; line: number; severity: 'error' | 'warn'; message: string }

function scanMigrations(): Finding[] {
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'))
  const findings: Finding[] = []
  for (const file of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    const lines = content.split(/\r?\n/)
    lines.forEach((line, idx) => {
      const l = line.toLowerCase()
      if (/\bdrop\s+table\b/.test(l)) {
        findings.push({ file, line: idx + 1, severity: 'error', message: 'DROP TABLE detected. Use expand-and-contract strategy.' })
      }
      if (/\bdrop\s+column\b/.test(l)) {
        findings.push({ file, line: idx + 1, severity: 'error', message: 'DROP COLUMN detected in migration. Remove in a later clean-up release.' })
      }
      if (/create\s+index\s+concurrently/i.test(line)) {
        findings.push({ file, line: idx + 1, severity: 'error', message: 'CREATE INDEX CONCURRENTLY cannot run inside a transaction. Use regular CREATE INDEX in transactional migrations.' })
      }
      if (/alter\s+table\b/.test(l) && /set\s+data\s+type\b/.test(l)) {
        findings.push({ file, line: idx + 1, severity: 'warn', message: 'Column type change detected. Consider backfill column + switch + drop later.' })
      }
    })
    // Light heuristic: ensure no explicit transaction control (BEGIN/COMMIT) conflict
    if (/begin;?/i.test(content) || /commit;?/i.test(content)) {
      findings.push({ file, line: 1, severity: 'warn', message: 'Explicit transaction control found. Supabase CLI wraps migrations; ensure correctness.' })
    }
  }
  return findings
}

async function runExplainIfRequested() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return
  const { Client } = await import('pg')
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'))
    for (const file of files) {
      const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      const lines = content.split(/\r?\n/)
      for (const [idx, line] of lines.entries()) {
        const m = line.match(/^\s*--\s*EXPLAIN:\s*(.+)$/i)
        if (m) {
          const query = m[1]
          try {
            const res = await client.query(`EXPLAIN ${query}`)
            // eslint-disable-next-line no-console
            console.log(`[EXPLAIN OK] ${file}:${idx + 1}\n${res.rows.map(r => r['QUERY PLAN']).join('\n')}`)
          } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error(`[EXPLAIN FAIL] ${file}:${idx + 1} -> ${e?.message || e}`)
            process.exitCode = 1
          }
        }
        const rls = line.match(/^\s*--\s*RLS_TEST:\s*(.+)$/i)
        if (rls) {
          // eslint-disable-next-line no-console
          console.log(`[RLS NOTE] ${file}:${idx + 1} ${rls[1]}`)
        }
      }
    }
  } finally {
    await client.end()
  }
}

async function main() {
  const findings = scanMigrations()
  let exitCode = 0
  for (const f of findings) {
    const prefix = f.severity === 'error' ? 'ERROR' : 'WARN'
    // eslint-disable-next-line no-console
    console.log(`[${prefix}] ${f.file}:${f.line} ${f.message}`)
    if (f.severity === 'error') exitCode = 1
  }
  await runExplainIfRequested()
  process.exit(exitCode)
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('migrate-check failed:', err)
  process.exit(1)
})
