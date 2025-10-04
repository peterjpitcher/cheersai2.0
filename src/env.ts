import { z } from "zod";

const serverSchema = z.object({
  ALERTS_SECRET: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  FACEBOOK_APP_SECRET: z.string().min(1),
  GOOGLE_MY_BUSINESS_CLIENT_ID: z.string().min(1),
  GOOGLE_MY_BUSINESS_CLIENT_SECRET: z.string().min(1),
  INSTAGRAM_APP_ID: z.string().min(1),
  INSTAGRAM_APP_SECRET: z.string().min(1),
  INSTAGRAM_VERIFY_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  VERCEL_OIDC_TOKEN: z.string().optional(),
  ENABLE_CONNECTION_DIAGNOSTICS: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_FACEBOOK_APP_ID: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
});

const serverEnv = serverSchema.safeParse(process.env);
const clientEnv = clientSchema.safeParse(process.env);

if (!serverEnv.success) {
  console.error("Invalid server environment variables", serverEnv.error.flatten().fieldErrors);
  throw new Error("Missing required server environment variables");
}

if (!clientEnv.success) {
  console.error("Invalid client environment variables", clientEnv.error.flatten().fieldErrors);
  throw new Error("Missing required client environment variables");
}

export const env = {
  server: serverEnv.data,
  client: clientEnv.data,
};

export const featureFlags = {
  connectionDiagnostics: (() => {
    const flag = env.server.ENABLE_CONNECTION_DIAGNOSTICS ?? process.env.ENABLE_CONNECTION_DIAGNOSTICS;
    if (!flag) return false;
    return flag === "1" || flag.toLowerCase() === "true";
  })(),
};
