/**
 * What the Google modules need from the outside world, passed in so tests can
 * supply fakes. Server only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GoogleAccessTokenOptions, GoogleAccessTokenResult } from "@/lib/connections/google-token";
import type { ManagementEventClient } from "@/lib/google-posts/management-lookup";

export interface GooglePostsDeps {
  /** Service-role client. Every query is scoped by account_id. */
  db: SupabaseClient;
  /** Used for Google only. */
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** 0 to 1, for backoff jitter. */
  random: () => number;
  getAccessToken: (
    db: SupabaseClient,
    accountId: string,
    options?: GoogleAccessTokenOptions,
  ) => Promise<GoogleAccessTokenResult>;
  /** The management app, for event details at creation time. Null: never called. */
  management: ManagementEventClient | null;
}

/** The real dependencies, imported lazily so this file stays cheap to import in tests. */
export async function defaultGooglePostsDeps(): Promise<GooglePostsDeps> {
  const [{ createServiceSupabaseClient }, { getGoogleAccessToken }, management] = await Promise.all([
    import("@/lib/supabase/service"),
    import("@/lib/connections/google-token"),
    import("@/lib/management-app/client"),
  ]);
  return {
    db: createServiceSupabaseClient(),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    getAccessToken: getGoogleAccessToken,
    management: {
      list: (config, options) => management.listManagementEvents(config, options),
      detail: (config, eventId) => management.getManagementEventDetail(config, eventId),
    },
  };
}
