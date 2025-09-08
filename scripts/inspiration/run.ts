#!/usr/bin/env tsx
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

