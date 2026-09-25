#!/usr/bin/env tsx
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '../../src/lib/token-vault';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const metaGraphVersion =
  process.env.META_GRAPH_VERSION ??
  process.env.NEXT_PUBLIC_META_GRAPH_VERSION ??
  'v24.0';

type Args = {
  accountId: string | null;
  query: string;
  limit: number;
};

type MetaInterest = {
  id: string;
  name: string;
  path?: string[];
  description?: string | null;
  audience_size?: number | null;
  audience_size_lower_bound?: number | null;
  audience_size_upper_bound?: number | null;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('Usage: npm run ops:search-meta-interests -- --account-id <account_uuid> "private hire"');
    process.exit(1);
  }
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Supabase credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const query = supabase
    .from('meta_ad_accounts')
    .select('account_id, meta_account_id, access_token')
    .eq('setup_complete', true);

  const { data, error } = args.accountId
    ? await query.eq('account_id', args.accountId).maybeSingle()
    : await query.limit(1).maybeSingle();

  if (error) {
    console.error('Failed to load Meta ad account:', error.message);
    process.exit(1);
  }
  if (!data) {
    console.error('No Meta Ads account found for the selected brand.');
    process.exit(1);
  }

  // Read only: never write a token from a local machine, whose TOKEN_VAULT_KEY may
  // not match production's.
  const accessToken = await loadAccessToken(supabase, data.account_id, data.access_token);
  if (!accessToken) {
    console.error('No Meta Ads access token found for the selected account.');
    process.exit(1);
  }

  const interests = await searchInterests(accessToken, args.query, args.limit);
  console.log(JSON.stringify({
    accountId: data.account_id,
    metaAccountId: data.meta_account_id,
    query: args.query,
    interests,
  }, null, 2));
}

// The encrypted token (meta_ad_account_tokens) wins; the plaintext column is the
// phase 1 fallback for brands not yet migrated.
async function loadAccessToken(
  supabase: SupabaseClient,
  accountId: string,
  plaintextToken: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('meta_ad_account_tokens')
    .select('ciphertext, iv, tag, key_version')
    .eq('account_id', accountId)
    .eq('token_type', 'access')
    .maybeSingle();
  if (error) {
    console.error('Failed to load the encrypted Meta Ads token:', error.message);
    process.exit(1);
  }
  if (data) {
    return decrypt({ ciphertext: data.ciphertext, iv: data.iv, tag: data.tag, keyVersion: data.key_version });
  }
  return plaintextToken?.trim() || null;
}

function parseArgs(argv: string[]): Args {
  let accountId: string | null = process.env.CHEERSAI_ACCOUNT_ID ?? null;
  let limit = 10;
  const queryParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--account-id') {
      accountId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(50, Math.floor(parsed));
      }
      index += 1;
      continue;
    }
    if (arg) queryParts.push(arg);
  }

  return {
    accountId,
    query: queryParts.join(' ').trim(),
    limit,
  };
}

async function searchInterests(
  accessToken: string,
  query: string,
  limit: number,
): Promise<MetaInterest[]> {
  const params = new URLSearchParams({
    access_token: accessToken,
    type: 'adinterest',
    q: query,
    limit: String(limit),
  });
  const response = await fetch(`https://graph.facebook.com/${metaGraphVersion}/search?${params.toString()}`);
  const json = await response.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } };

  if (!response.ok || json.error) {
    throw new Error(json.error?.message ?? 'Meta interest lookup failed.');
  }

  return (json.data ?? []).map((item) => ({
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    path: Array.isArray(item.path)
      ? item.path.filter((pathItem): pathItem is string => typeof pathItem === 'string')
      : undefined,
    description: typeof item.description === 'string' ? item.description : null,
    audience_size: normaliseNumber(item.audience_size),
    audience_size_lower_bound: normaliseNumber(item.audience_size_lower_bound),
    audience_size_upper_bound: normaliseNumber(item.audience_size_upper_bound),
  })).filter((item) => item.id && item.name);
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
