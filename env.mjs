// Runtime environment validation using zod
// Import this in server-side boot points (e.g., next.config.ts) to fail fast on misconfig
import { z } from 'zod'

const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID

const schema = z.object({
  // Public (client-safe) URLs
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPPORT_EMAIL: z.string().email().optional(),

  // Server-side secrets
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  ENCRYPTION_SECRET: z.string().min(16).optional(),
  ENCRYPTION_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().min(10).optional(),
  STRIPE_SECRET_KEY: z.string().min(10).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(10).optional(),
  RESEND_API_KEY: z.string().min(10).optional(),
  RESEND_FROM: z.string().optional(),
  SUPPORT_EMAIL: z.string().email().optional(),
  CRON_SECRET: z.string().min(16),

  // Social APIs
  FACEBOOK_APP_SECRET: z.string().min(10).optional(),
  GOOGLE_MY_BUSINESS_CLIENT_ID: z.string().optional(),
  GOOGLE_MY_BUSINESS_CLIENT_SECRET: z.string().optional(),
  TWITTER_CLIENT_ID: z.string().optional(),
  TWITTER_CLIENT_SECRET: z.string().optional(),

  // Optional monitoring
  SENTRY_DSN: z.string().url().optional(),

  // Public Stripe keys (optional; used in client)
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_STARTER_MONTHLY_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_STARTER_ANNUAL_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PRO_ANNUAL_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_STARTER_IMAGES_MONTHLY_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_STARTER_IMAGES_ANNUAL_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PRO_IMAGES_MONTHLY_PRICE_ID: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PRO_IMAGES_ANNUAL_PRICE_ID: z.string().optional(),

  // Optional redis (rate limit)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
})

export const Env = isTest ? (process.env) : schema.parse(process.env)

export default Env
