import { createClient } from "@supabase/supabase-js";

import { env } from "@/env";

export function createServiceSupabaseClient() {
  return createClient(env.client.NEXT_PUBLIC_SUPABASE_URL, env.server.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
}
