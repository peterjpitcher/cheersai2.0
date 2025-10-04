import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/env";

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    env.client.NEXT_PUBLIC_SUPABASE_URL,
    env.client.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
