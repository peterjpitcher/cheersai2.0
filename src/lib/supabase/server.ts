import { cookies } from "next/headers";
import type { UnsafeUnwrappedCookies } from "next/dist/server/request/cookies";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { env } from "@/env";

export async function createServerSupabaseClient() {
  const cookieStore = (await cookies()) as unknown as UnsafeUnwrappedCookies;

  const setCookie = (() => {
    try {
      cookieStore.set("sb-test", "1");
      cookieStore.delete("sb-test");
      return cookieStore.set.bind(cookieStore) as UnsafeUnwrappedCookies["set"];
    } catch {
      return null;
    }
  })();

  return createServerClient(
    env.client.NEXT_PUBLIC_SUPABASE_URL,
    env.client.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          if (!setCookie) return;
          cookiesToSet.forEach(({ name, value, options }) => {
            setCookie(name, value, options);
          });
        },
      },
    },
  );
}
