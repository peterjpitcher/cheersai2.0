import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/env";

export class MissingSupabaseCredentialsError extends Error {
  constructor(message = "Supabase credentials are not configured") {
    super(message);
    this.name = "MissingSupabaseCredentialsError";
  }
}

export function isServiceSupabaseConfigured(): boolean {
  return Boolean(env.client.NEXT_PUBLIC_SUPABASE_URL && env.server.SUPABASE_SERVICE_ROLE_KEY);
}

export function createServiceSupabaseClient(): SupabaseClient {
  if (!isServiceSupabaseConfigured()) {
    throw new MissingSupabaseCredentialsError();
  }

  return createClient(env.client.NEXT_PUBLIC_SUPABASE_URL, env.server.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
}

export function tryCreateServiceSupabaseClient(): SupabaseClient | null {
  try {
    return createServiceSupabaseClient();
  } catch (error) {
    if (error instanceof MissingSupabaseCredentialsError) {
      return null;
    }
    throw error;
  }
}
