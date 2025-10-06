function readOptionalEnv(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function readClientEnv(key: string, fallback = ""): string {
  const value = process.env[key];
  if (!value) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return fallback;
  }
  return value;
}

function readSupabaseClientEnv(primaryKey: string, fallbackKey: string): string {
  const primary = process.env[primaryKey];
  if (primary && primary.length) {
    return primary;
  }

  if (typeof window === "undefined") {
    const fallback = process.env[fallbackKey];
    if (fallback && fallback.length) {
      return fallback;
    }
  }

  throw new Error(`Missing required environment variable: ${primaryKey}`);
}

const serverEnv = {
  ALERTS_SECRET: readOptionalEnv("ALERTS_SECRET"),
  CRON_SECRET: readOptionalEnv("CRON_SECRET"),
  FACEBOOK_APP_SECRET: readOptionalEnv("FACEBOOK_APP_SECRET"),
  GOOGLE_MY_BUSINESS_CLIENT_ID: readOptionalEnv("GOOGLE_MY_BUSINESS_CLIENT_ID"),
  GOOGLE_MY_BUSINESS_CLIENT_SECRET: readOptionalEnv("GOOGLE_MY_BUSINESS_CLIENT_SECRET"),
  INSTAGRAM_APP_ID: readOptionalEnv("INSTAGRAM_APP_ID"),
  INSTAGRAM_APP_SECRET: readOptionalEnv("INSTAGRAM_APP_SECRET"),
  INSTAGRAM_VERIFY_TOKEN: readOptionalEnv("INSTAGRAM_VERIFY_TOKEN"),
  OPENAI_API_KEY: readOptionalEnv("OPENAI_API_KEY"),
  RESEND_API_KEY: readOptionalEnv("RESEND_API_KEY"),
  RESEND_FROM: readOptionalEnv("RESEND_FROM"),
  SUPABASE_SERVICE_ROLE_KEY: readOptionalEnv("SUPABASE_SERVICE_ROLE_KEY"),
  ENABLE_CONNECTION_DIAGNOSTICS: process.env.ENABLE_CONNECTION_DIAGNOSTICS ?? undefined,
} as const;

const clientEnv = {
  NEXT_PUBLIC_FACEBOOK_APP_ID: readClientEnv("NEXT_PUBLIC_FACEBOOK_APP_ID"),
  NEXT_PUBLIC_SITE_URL: readClientEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: readSupabaseClientEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"),
  NEXT_PUBLIC_SUPABASE_URL: readSupabaseClientEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
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
