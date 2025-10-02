#!/usr/bin/env tsx

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { recomputeCampaignStatus } from '@/lib/campaigns/status'

dotenv.config({ path: '.env.local' })
dotenv.config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const pageSize = 100
  let offset = 0
  let processed = 0
  let updates = 0

  for (;;) {
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error('Failed to fetch campaigns:', error.message)
      process.exit(1)
    }

    if (!campaigns || campaigns.length === 0) {
      break
    }

    for (const campaign of campaigns) {
      if (!campaign?.id) continue
      const result = await recomputeCampaignStatus(supabase, campaign.id)
      processed += 1
      if (result.changed) updates += 1
      if (processed % 50 === 0) {
        console.log(`Processed ${processed} campaigns (updated ${updates})`)
      }
    }

    offset += campaigns.length
    if (campaigns.length < pageSize) break
  }

  console.log(`Done. Processed ${processed} campaigns, updated ${updates}.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
