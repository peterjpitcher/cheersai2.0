import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { env } from "@/env";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

type MutableCookieStore = CookieStore & {
  set: (name: string, value: string, options?: CookieOptions) => void;
  delete: (name: string, options?: CookieOptions) => void;
};

function hasMutableCookies(store: CookieStore): store is MutableCookieStore {
  return typeof (store as MutableCookieStore).set === "function" && typeof (store as MutableCookieStore).delete === "function";
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  const setCookie = (() => {
    if (!hasMutableCookies(cookieStore)) return null;
    try {
      cookieStore.set("sb-test", "1");
      cookieStore.delete("sb-test");
      return cookieStore.set.bind(cookieStore);
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
