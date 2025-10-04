const DEFAULT_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const DEFAULT_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "public-anon-key";
const DEFAULT_FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID ?? "";

const serverEnv = {
  ALERTS_SECRET: process.env.ALERTS_SECRET ?? "",
  CRON_SECRET: process.env.CRON_SECRET ?? "",
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET ?? "",
  GOOGLE_MY_BUSINESS_CLIENT_ID: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID ?? "",
  GOOGLE_MY_BUSINESS_CLIENT_SECRET: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET ?? "",
  INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID ?? "",
  INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET ?? "",
  INSTAGRAM_VERIFY_TOKEN: process.env.INSTAGRAM_VERIFY_TOKEN ?? "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  RESEND_FROM: process.env.RESEND_FROM ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ENABLE_CONNECTION_DIAGNOSTICS: process.env.ENABLE_CONNECTION_DIAGNOSTICS ?? undefined,
} as const;

const clientEnv = {
  NEXT_PUBLIC_FACEBOOK_APP_ID: DEFAULT_FACEBOOK_APP_ID,
  NEXT_PUBLIC_SITE_URL: DEFAULT_SITE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: DEFAULT_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL: DEFAULT_SUPABASE_URL,
} as const;

export const env = {
  server: serverEnv,
  client: clientEnv,
};

type ServerEnvKey = keyof typeof serverEnv;

type ClientEnvKey = keyof typeof clientEnv;

export function requireServerEnv(key: ServerEnvKey): string {
  const value = serverEnv[key];
  if (!value) {
    throw new Error(`Missing required server environment variable: ${key}`);
  }
  return value;
}

export function isServerEnvConfigured(key: ServerEnvKey): boolean {
  return Boolean(serverEnv[key]);
}

export function requireClientEnv(key: ClientEnvKey): string {
  const value = clientEnv[key];
  if (!value) {
    throw new Error(`Missing required client environment variable: ${key}`);
  }
  return value;
}

export const featureFlags = {
  connectionDiagnostics: (() => {
    const flag = serverEnv.ENABLE_CONNECTION_DIAGNOSTICS ?? process.env.ENABLE_CONNECTION_DIAGNOSTICS;
    if (!flag) return false;
    return flag === "1" || flag.toLowerCase() === "true";
  })(),
};
