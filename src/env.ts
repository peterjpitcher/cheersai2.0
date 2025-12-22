const isServerRuntime = typeof window === "undefined";

function readOptionalEnv(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function resolveSupabaseUrl(): string {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (publicUrl && publicUrl.length) {
    return publicUrl;
  }

  if (isServerRuntime) {
    const serverUrl = process.env.SUPABASE_URL;
    if (serverUrl && serverUrl.length) {
      return serverUrl;
    }
  }

  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
}

function resolveSupabaseAnonKey(): string {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey && anonKey.length) {
    return anonKey;
  }

  if (isServerRuntime) {
    const serverKey = process.env.SUPABASE_ANON_KEY;
    if (serverKey && serverKey.length) {
      return serverKey;
    }
  }

  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

const DEFAULT_META_GRAPH_VERSION = (() => {
  const explicit = process.env.META_GRAPH_VERSION;
  if (explicit && explicit.length) {
    return explicit;
  }

  const publicVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION;
  if (publicVersion && publicVersion.length) {
    return publicVersion;
  }

  return "v24.0";
})();

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
  META_GRAPH_VERSION: readOptionalEnv("META_GRAPH_VERSION", DEFAULT_META_GRAPH_VERSION),
  ENABLE_CONNECTION_DIAGNOSTICS: process.env.ENABLE_CONNECTION_DIAGNOSTICS ?? undefined,
} as const;

const clientEnv = {
  NEXT_PUBLIC_FACEBOOK_APP_ID: readOptionalEnv("NEXT_PUBLIC_FACEBOOK_APP_ID"),
  NEXT_PUBLIC_SITE_URL: readOptionalEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: resolveSupabaseAnonKey(),
  NEXT_PUBLIC_SUPABASE_URL: resolveSupabaseUrl(),
  NEXT_PUBLIC_META_GRAPH_VERSION: readOptionalEnv(
    "NEXT_PUBLIC_META_GRAPH_VERSION",
    DEFAULT_META_GRAPH_VERSION,
  ),
} as const;

export const env = {
  server: serverEnv,
  client: clientEnv,
};

type ServerEnvKey = keyof typeof serverEnv;

type ClientEnvKey = keyof typeof clientEnv;

function validateProductionEnv() {
  if (!isServerRuntime) return;
  if (process.env.NODE_ENV !== "production") return;

  const requiredServerKeys: ServerEnvKey[] = [
    "CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FACEBOOK_APP_SECRET",
    "GOOGLE_MY_BUSINESS_CLIENT_ID",
    "GOOGLE_MY_BUSINESS_CLIENT_SECRET",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "OPENAI_API_KEY",
  ];

  const missing = requiredServerKeys.filter((key) => !serverEnv[key]);
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }

  const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl || /localhost|127\\.0\\.0\\.1/.test(siteUrl)) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be set to the deployed domain in production");
  }
}

validateProductionEnv();

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
