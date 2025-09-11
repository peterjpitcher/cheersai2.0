#!/usr/bin/env tsx
// Load env for CLI usage (prefer .env.local like Next.js)
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
const envLocal = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal })
else dotenv.config()

import { orchestrateInspiration } from '../../lib/inspiration/orchestrator'

async function main() {
  const args = process.argv.slice(2)
  const from = args.find(a => a.startsWith('--from='))?.split('=')[1]
  const to = args.find(a => a.startsWith('--to='))?.split('=')[1]
  const dryRun = args.includes('--dry-run')
  const forceBriefs = args.includes('--force-briefs')

  const res = await orchestrateInspiration({ from, to, dryRun, forceBriefs })
  console.log(JSON.stringify(res, null, 2))
}

main().catch(err => { console.error(err); process.exit(1) })
