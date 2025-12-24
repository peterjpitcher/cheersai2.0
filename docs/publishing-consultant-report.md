# Publishing Pipeline Consultant Report (cheersai2.0)

## Purpose
This report provides a comprehensive, standalone view of the publishing pipeline. It includes the relevant config, code, schema, and known issues so an external consultant can diagnose why publishing is not working without direct repo access.


## Executive Summary
- Publishing is currently failing in production. Multiple fixes have been attempted, with no clear root cause yet.
- The publish pipeline is driven by a Vercel Cron -> Next.js API route -> Supabase Edge Function (publish-queue).
- Jobs are stored in Postgres (publish_jobs) and the worker executes provider adapters (Facebook, Instagram, GBP).
- Known prior issues include story variant lookups failing and Facebook story API errors.
- There are conflicting notes on scheduler configuration (Vercel Cron vs Supabase Scheduler).


## System Overview (High Level)
1) Content is created and scheduled in the Next.js app (content_items + content_variants).
2) Scheduling/approval enqueues publish_jobs (via enqueuePublishJob).
3) Vercel Cron hits /api/cron/publish every minute.
4) /api/cron/publish validates CRON_SECRET and invokes the Supabase Edge Function publish-queue.
5) publish-queue fetches due jobs, locks them, loads content/variant/media/connection data, and publishes via provider adapters.
6) Worker updates statuses and creates notifications.


## Cron and Scheduler Details
- Vercel Cron schedule is defined in vercel.json.
- /api/cron/publish expects CRON_SECRET via x-cron-secret header, Authorization header, or ?secret query param.
- The route then calls the Supabase Edge Function publish-queue with the service role key.
- Supabase config.toml only sets verify_jwt flags. It does not declare schedules.
- runbook and handoff/backlog notes conflict: runbook says Supabase Scheduler should be disabled for publish-queue, while backlog/handoff mention managing schedules via supabase/config.toml. This mismatch is a candidate root cause if the intended scheduler is not actually running.


## Suspected Failure Points (Hypotheses)
1) Cron auth mismatch: Vercel Cron may not be sending CRON_SECRET as expected, causing /api/cron/publish to return 401.
2) Missing env vars in Vercel or Supabase Edge functions (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, RESEND_*).
3) publish-queue Edge Function not deployed or running an older version (per story-variant issue notes).
4) Jobs never enqueued (publish_jobs missing) or jobs stuck in queued/in_progress.
5) Connection metadata missing (pageId/igBusinessId/locationId) or tokens expired, forcing needs_action.
6) Story media derivative missing or not generated, causing story publishes to fail.
7) Provider API errors (notably Facebook story API returning 500 code 1).


## Known Prior Issues (From Internal Notes)
- Story variant lookup failures: jobs failing with 'No content variant available' even when variants exist. A migration now stores variant_id on publish_jobs and the worker logs DB context; production may still be on an older worker build.
- Facebook story publish errors: Graph API /photo_stories returning HTTP 500 code 1 despite valid signed media URLs. This appears to be a Meta-side issue; a support ticket may be required.


## Code and Config Snippets (ASCII-normalized)
Note: Any non-ASCII characters (emoji, smart quotes, arrows) have been replaced with ASCII equivalents for report portability. Logic is unchanged.


### Vercel cron schedule
`vercel.json`
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/publish",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/purge-trash",
      "schedule": "15 3 * * *"
    }
  ]
}

```

### Cron bridge route (Vercel -> Supabase Edge Function)
`src/app/api/cron/publish/route.ts`
```ts
import { NextResponse } from "next/server";

const PUBLISH_FUNCTION = "publish-queue";

async function invokePublishQueue() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    return {
      ok: false,
      status: 500,
      body: { error: "Supabase environment missing" },
    } as const;
  }

  const functionUrl = `${supabaseUrl}/functions/v1/${PUBLISH_FUNCTION}`;

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ source: "cron" }),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        body: {
          error: "Publish queue invocation failed",
          edgeStatus: response.status,
          responseText: await response.text(),
        },
      } as const;
    }

    return {
      ok: true,
      status: 200,
      body: await response.json().catch(() => ({})),
    } as const;
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: {
        error: "Failed to call publish queue",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const;
  }
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const headerSecret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization");
  const urlSecret = new URL(request.url).searchParams.get("secret");
  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await invokePublishQueue();
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

```

### Supabase function config
`supabase/config.toml`
```toml
project_id = "cheersai"

[functions."publish-queue"]
  verify_jwt = false

[functions."materialise-weekly"]
  verify_jwt = false

[functions."media-derivatives"]
  verify_jwt = false

# NOTE: Scheduler cron definitions live in runbook; apply via `supabase functions schedule create` until CLI adds config support.


```

### publish-queue entrypoint
`supabase/functions/publish-queue/index.ts`
```ts
/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { PublishQueueWorker, createDefaultConfig, type PublishJobPayload } from "./worker.ts";

const config = createDefaultConfig();
const worker = new PublishQueueWorker(config);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: PublishJobPayload | undefined;
  try {
    payload = await request.json();
  } catch (error) {
    console.warn("[publish-queue] received non-JSON payload", error);
  }

  const leadWindowMinutes = payload?.leadWindowMinutes ?? 5;
  const source = payload?.source ?? "unknown";
  const result = await worker.processDueJobs(leadWindowMinutes, source);

  return Response.json({ ok: true, ...result });
});

```

### publish-queue worker
`supabase/functions/publish-queue/worker.ts`
```ts
// @ts-nocheck
/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { publishToFacebook } from "./providers/facebook.ts";
import { publishToInstagram } from "./providers/instagram.ts";
import { publishToGBP } from "./providers/gbp.ts";
import { resolveConnectionMetadata } from "./metadata.ts";
import type {
    ProviderMedia,
    ProviderPlatform,
    ProviderPlacement,
    ProviderPublishRequest,
    ProviderPublishResult,
} from "./providers/types.ts";

export interface PublishJobPayload {
    leadWindowMinutes?: number;
    source?: string;
}

export interface PublishJobRow {
    id: string;
    content_item_id: string;
    status: string;
    next_attempt_at: string | null;
    attempt: number | null;
    placement: "feed" | "story";
    variant_id: string;
}

type ContentStatus = "draft" | "scheduled" | "publishing" | "posted" | "failed";

type VariantRow = {
    id: string;
    content_item_id: string;
    body: string | null;
    media_ids: string[] | null;
};

type ConnectionStatus = "active" | "expiring" | "needs_action";

type ContentRow = {
    id: string;
    account_id: string;
    platform: ProviderPlatform;
    placement: "feed" | "story";
    scheduled_for: string | null;
    prompt_context: Record<string, unknown> | null;
    campaigns: {
        name: string | null;
    } | null;
}

type ScheduledContentRow = {
    id: string;
    scheduled_for: string | null;
    placement: "feed" | "story";
}

type ConnectionRow = {
    id: string;
    provider: ProviderPlatform;
    status: ConnectionStatus;
    access_token: string | null;
    refresh_token: string | null;
    expires_at: string | null;
    display_name: string | null;
    metadata: Record<string, unknown> | null;
}

type MediaRow = {
    id: string;
    storage_path: string;
    media_type: "image" | "video";
    mime_type: string | null;
    derived_variants: Record<string, unknown> | null;
    processed_status?: string | null;
}

// Environment Configuration Interface
export interface PublishWorkerRetries {
    maxAttempts: number;
    backoffMinutes: number[];
    storyGraceMinutes: number;
    variantRetryDelaySeconds: number;
    maxVariantRetries: number;
}

export interface PublishWorkerConfig {
    supabaseUrl: string;
    serviceRoleKey: string;
    mediaBucket: string;
    mediaSignedUrlTtlSeconds: number;
    resendApiKey?: string;
    resendFrom?: string;
    alertEmail?: string;
    retries: PublishWorkerRetries;
}

// Default config factory
export function createDefaultConfig(): PublishWorkerConfig {
    const parseBackoff = (value?: string | null) => {
        if (!value) return null;
        const parts = value
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
        return parts.length ? parts : null;
    };

    const resolveMaxAttempts = (value?: string | null) => {
        if (!value) return 3;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 1) return 3;
        return Math.floor(parsed);
    };

    return {
        supabaseUrl: Deno.env.get("NEXT_PUBLIC_SUPABASE_URL")!,
        serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        mediaBucket: Deno.env.get("MEDIA_BUCKET") ?? "media",
        mediaSignedUrlTtlSeconds: Number(Deno.env.get("MEDIA_SIGNED_URL_TTL_SECONDS") ?? 3600),
        resendApiKey: Deno.env.get("RESEND_API_KEY"),
        resendFrom: Deno.env.get("RESEND_FROM"),
        alertEmail: Deno.env.get("ALERT_EMAIL") ?? Deno.env.get("OWNER_ALERT_EMAIL") ?? "notifications@cheersai.uk",
        retries: {
            maxAttempts: resolveMaxAttempts(Deno.env.get("PUBLISH_MAX_ATTEMPTS")),
            backoffMinutes: parseBackoff(Deno.env.get("PUBLISH_RETRY_MINUTES")) ?? [5, 15, 30],
            storyGraceMinutes: Number(Deno.env.get("STORY_GRACE_MINUTES") ?? 5),
            variantRetryDelaySeconds: Number(Deno.env.get("VARIANT_RETRY_DELAY_SECONDS") ?? 45),
            maxVariantRetries: Number(Deno.env.get("MAX_VARIANT_RETRIES") ?? 3),
        }
    };
}

// Core Worker Class
export class PublishQueueWorker {
    private supabase: SupabaseClient;
    private config: PublishWorkerConfig;

    constructor(config: PublishWorkerConfig, supabaseClient?: SupabaseClient) {
        this.config = config;
        this.supabase = supabaseClient ?? createClient(config.supabaseUrl, config.serviceRoleKey, {
            auth: { persistSession: false },
        });
    }

    async recoverStuckJobs(timeoutMinutes = 15) {
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const cutoff = new Date(Date.now() - timeoutMs).toISOString();

        const { error, count } = await this.supabase
            .from("publish_jobs")
            .update({
                status: "queued",
                last_error: "Job recovered from stuck in_progress state",
                updated_at: new Date().toISOString(),
            })
            .eq("status", "in_progress")
            .lt("updated_at", cutoff)
            .select("id", { count: "exact", head: true });

        if (error) {
            console.error("[publish-queue] failed to recover stuck jobs", error);
        } else if (count && count > 0) {
            console.info(`[publish-queue] recovered ${count} stuck jobs`);
        }
    }

    async processDueJobs(leadWindowMinutes = 5, source = "unknown") {
        const now = new Date();
        const nowIso = now.toISOString();
        await this.recordHeartbeat(source, nowIso);
        await this.recoverStuckJobs();

        const windowIso = new Date(now.getTime() + leadWindowMinutes * 60 * 1000).toISOString();
        await this.ensureJobsForScheduledContent(windowIso, nowIso);
        const { data: jobs, error } = await this.supabase
            .from("publish_jobs")
            .select("id, content_item_id, variant_id, status, next_attempt_at, attempt, placement")
            .eq("status", "queued")
            .lte("next_attempt_at", windowIso)
            .order("next_attempt_at", { ascending: true })
            .limit(20);

        if (error) {
            console.error("[publish-queue] publish_jobs fetch failed", error);
            return { processed: 0, error };
        }

        if (!jobs?.length) {
            return { processed: 0 };
        }

        let processed = 0;
        const results = [];

        for (const job of jobs) {
            try {
                await this.handleJob(job);
                processed += 1;
                results.push({ id: job.id, status: 'processed' });
            } catch (err) {
                console.error(`[publish-queue] unexpected error handling job ${job.id}`, err);
                results.push({ id: job.id, status: 'error', error: err });
            }
        }

        return { processed, results };
    }

    protected async recordHeartbeat(source: string, nowIso: string) {
        const { error } = await this.supabase
            .from("worker_heartbeats")
            .upsert(
                {
                    name: "publish-queue",
                    last_run_at: nowIso,
                    last_run_source: source,
                    updated_at: nowIso,
                },
                { onConflict: "name" },
            );

        if (error) {
            console.warn("[publish-queue] failed to record heartbeat", error);
        }
    }

    protected async ensureJobsForScheduledContent(windowIso: string, nowIso: string) {
        const { data: scheduledContent, error } = await this.supabase
            .from("content_items")
            .select("id, scheduled_for, placement")
            .in("status", ["scheduled", "queued"])
            .is("deleted_at", null)
            .lte("scheduled_for", windowIso)
            .limit(50)
            .returns<ScheduledContentRow[]>();

        if (error) {
            console.error("[publish-queue] failed to load scheduled content", error);
            return;
        }

        if (!scheduledContent?.length) {
            return;
        }

        const contentIds = scheduledContent.map((row) => row.id);
        const { data: existingJobs, error: existingError } = await this.supabase
            .from("publish_jobs")
            .select("content_item_id")
            .in("content_item_id", contentIds);

        if (existingError) {
            console.error("[publish-queue] failed to load existing publish jobs", existingError);
            return;
        }

        const existingIds = new Set((existingJobs ?? []).map((job) => job.content_item_id));
        const missingContent = scheduledContent.filter((row) => !existingIds.has(row.id));
        if (!missingContent.length) {
            return;
        }

        console.info(`[publish-queue] found ${missingContent.length} scheduled items missing jobs`, { ids: missingContent.map(c => c.id) });

        const { data: variantRows, error: variantError } = await this.supabase
            .from("content_variants")
            .select("id, content_item_id, updated_at")
            .in("content_item_id", missingContent.map((row) => row.id))
            .order("updated_at", { ascending: false });

        if (variantError) {
            console.error("[publish-queue] failed to load variants for scheduled content", variantError);
            return;
        }

        // Group variants by content_item_id and pick the first (latest due to sort)
        const variantIdByContent = new Map<string, string>();
        for (const row of (variantRows ?? [])) {
            if (!variantIdByContent.has(row.content_item_id)) {
                variantIdByContent.set(row.content_item_id, row.id);
            }
        }

        const jobRows = missingContent
            .map((content) => {
                const variantId = variantIdByContent.get(content.id);
                if (!variantId) {
                    console.warn(`[publish-queue] missing variant for scheduled content ${content.id}`);
                    return null;
                }

                return {
                    content_item_id: content.id,
                    variant_id: variantId,
                    status: "queued",
                    next_attempt_at: content.scheduled_for ?? nowIso,
                    placement: content.placement ?? "feed",
                };
            })
            .filter((row): row is NonNullable<typeof row> => Boolean(row));

        if (!jobRows.length) {
            return;
        }

        const { error: insertError } = await this.supabase
            .from("publish_jobs")
            .insert(jobRows);

        if (insertError) {
            console.error("[publish-queue] failed to insert missing publish jobs", insertError);
        } else {
            console.info(`[publish-queue] inserted ${jobRows.length} missing publish jobs`);
        }
    }

    // Exposed for testing
    async handleJob(job: PublishJobRow) {
        const now = new Date();
        const nowIso = now.toISOString();
        const currentAttempt = (job.attempt ?? 0) + 1;

        const locked = await this.lockJob(job.id, currentAttempt, nowIso);
        if (!locked) {
            return;
        }

        const content = await this.loadContent(job.content_item_id);
        if (!content) {
            await this.markJobMissingContent(job.id, nowIso);
            return;
        }

        if (content.placement === "story" && content.scheduled_for) {
            const scheduledAt = new Date(content.scheduled_for);
            if (Number.isFinite(scheduledAt.getTime())) {
                const minutesLate = (now.getTime() - scheduledAt.getTime()) / (60 * 1000);
                if (minutesLate > this.config.retries.storyGraceMinutes) {
                    await this.handleFailure({
                        jobId: job.id,
                        content,
                        attempt: currentAttempt,
                        now,
                        message: "Story missed its scheduled window",
                        retryable: false,
                    });
                    return;
                }
            }
        }

        await this.logDbContext('before_variant_fetch', job.id, currentAttempt);

        const variant = await this.loadVariant(job.variant_id);

        if (!variant) {
            if (currentAttempt <= this.config.retries.maxVariantRetries) {
                await this.scheduleVariantRetry({ job, content, attempt: currentAttempt, now });
                return;
            }

            await this.handleFailure({
                jobId: job.id,
                content,
                attempt: currentAttempt,
                now,
                message: "Variant not found",
                retryable: false,
            });
            return;
        }

        if (variant.content_item_id !== content.id) {
            console.warn(`[publish-queue] variant/content mismatch for job ${job.id}`, {
                variantContentId: variant.content_item_id,
                contentId: content.id,
            });
        }

        const rawCopy = variant.body?.trim() ?? "";
        const requiresCopy = content.placement !== "story";
        if (requiresCopy && !rawCopy) {
            await this.handleFailure({
                jobId: job.id,
                content,
                attempt: currentAttempt,
                now,
                message: "Content copy missing",
                retryable: false,
            });
            return;
        }

        const copy = content.placement === "story" ? "" : rawCopy;

        const connection = await this.loadConnection(content.account_id, content.platform);
        if (!connection) {
            await this.handleFailure({
                jobId: job.id,
                content,
                attempt: currentAttempt,
                now,
                message: `No connection configured for ${content.platform}`,
                retryable: false,
            });
            return;
        }

        const usable = this.isConnectionUsable(connection, now);
        if (!usable.valid) {
            await this.forceConnectionNeedsAction(connection, content.account_id, usable.reason ?? "Connection unavailable", nowIso);
            await this.handleFailure({
                jobId: job.id,
                content,
                attempt: currentAttempt,
                now,
                message: usable.reason ?? "Connection not ready",
                retryable: false,
            });
            return;
        }

        const metadataResult = resolveConnectionMetadata(connection.provider, connection.metadata ?? null);
        if (!metadataResult.ok) {
            await this.forceConnectionNeedsAction(connection, content.account_id, metadataResult.error, nowIso);
            await this.handleFailure({
                jobId: job.id,
                content,
                attempt: currentAttempt,
                now,
                message: metadataResult.error,
                retryable: false,
            });
            await this.sendEmailNotification(
                `Action needed: ${connection.provider} metadata missing`,
                `<p>We could not publish <strong>${connection.provider}</strong> content because required metadata is missing.</p><p>${metadataResult.error}</p>`
            );
            return;
        }

        await this.markContentStatus(content.id, "publishing", nowIso);

        let media: ProviderMedia[] = [];
        try {
            media = await this.loadMedia(variant.media_ids ?? [], content.placement);
        } catch (mediaError) {
            const message = this.extractErrorMessage(mediaError);
            console.error(`[publish-queue] failed to load media for ${content.id}`, mediaError);
            await this.handleFailure({
                jobId: job.id,
                content,
                attempt: currentAttempt,
                now,
                message,
                retryable: false,
            });
            return;
        }

        const request: ProviderPublishRequest = {
            payload: {
                body: copy,
                media,
                scheduledFor: content.scheduled_for,
                campaignName: content.campaigns?.name ?? null,
                promptContext: content.prompt_context,
                placement: content.placement,
            },
            auth: {
                connectionId: connection.id,
                accessToken: connection.access_token!,
                refreshToken: connection.refresh_token,
                expiresAt: connection.expires_at,
            },
            accountId: content.account_id,
            contentId: content.id,
            attempt: currentAttempt,
            connectionMetadata: metadataResult.metadata,
            placement: content.placement,
        };

        try {
            const providerResponse = await this.publishByPlatform(content.platform, request);
            await this.markJobSucceeded(job.id, providerResponse, nowIso);
            await this.markContentStatus(content.id, "posted", nowIso);
            const successCategory = content.placement === "story" ? "story_publish_succeeded" : "publish_success";
            await this.insertNotification(content.account_id, successCategory, `Posted to ${content.platform} (${providerResponse.externalId})`, {
                jobId: job.id,
                contentId: content.id,
                providerResponse,
                placement: content.placement,
            });
        } catch (error) {
            const message = this.extractErrorMessage(error);
            const authFailure = /token|permission|credential|unauthor|authenticat|authoriz/i.test(message);
            const derivativeMissing = message.includes('Story derivative not available');
            const mediaId = error && typeof error === "object" && "mediaId" in error
                ? (error as { mediaId?: string }).mediaId
                : undefined;

            if (derivativeMissing) {
                if (currentAttempt <= this.config.retries.maxVariantRetries) {
                    await this.scheduleDerivativeRetry({
                        job,
                        content,
                        attempt: currentAttempt,
                        now,
                        message,
                        mediaId,
                    });
                    return;
                }

                await this.handleFailure({
                    jobId: job.id,
                    content,
                    attempt: currentAttempt,
                    now,
                    message,
                    retryable: false,
                });

                await this.sendEmailNotification(
                    `Publish failed on ${content.platform} (${content.placement})`,
                    `<p>We attempted to publish content (${content.id}) to <strong>${content.platform} ${content.placement}</strong> but it failed.</p><p><strong>Error:</strong> ${message}</p>`
                );
                return;
            }

            await this.handleFailure({
                jobId: job.id,
                content,
                attempt: currentAttempt,
                now,
                message,
                retryable: !authFailure,
            });

            await this.sendEmailNotification(
                `Publish failed on ${content.platform} (${content.placement})`,
                `<p>We attempted to publish content (${content.id}) to <strong>${content.platform} ${content.placement}</strong> but it failed.</p><p><strong>Error:</strong> ${message}</p>`
            );

            if (authFailure) {
                await this.forceConnectionNeedsAction(connection, content.account_id, message, nowIso);
            }
        }
    }

    // --- Helpers ---

    // NOTE: This can be overridden in tests
    protected async publishByPlatform(platform: ProviderPlatform, request: ProviderPublishRequest): Promise<ProviderPublishResult> {
        switch (platform) {
            case "facebook":
                return publishToFacebook(request);
            case "instagram":
                return publishToInstagram(request);
            case "gbp":
                return publishToGBP(request);
            default:
                throw new Error(`Unsupported platform ${platform}`);
        }
    }

    private async sendEmailNotification(subject: string, html: string) {
        if (!this.config.resendApiKey || !this.config.resendFrom || !this.config.alertEmail) {
            return;
        }

        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.resendApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: this.config.resendFrom,
                to: [this.config.alertEmail],
                subject,
                html,
            }),
        });

        if (!response.ok) {
            console.error("[publish-queue] failed to send email", await response.text());
        }
    }

    private isConnectionUsable(connection: ConnectionRow, now: Date) {
        if (connection.status === "needs_action") {
            return { valid: false, reason: `${connection.display_name ?? connection.provider} needs attention` };
        }
        if (!connection.access_token) {
            return { valid: false, reason: "Access token missing" };
        }
        if (connection.expires_at) {
            const expiry = new Date(connection.expires_at);
            if (Number.isFinite(expiry.getTime()) && expiry.getTime() <= now.getTime()) {
                return { valid: false, reason: "Access token expired" };
            }
        }
        return { valid: true as const };
    }

    private getBackoffMinutes(attempt: number) {
        const index = Math.min(Math.max(attempt - 1, 0), this.config.retries.backoffMinutes.length - 1);
        return this.config.retries.backoffMinutes[index];
    }

    private async lockJob(jobId: string, attempt: number, nowIso: string) {
        const { data, error } = await this.supabase
            .from("publish_jobs")
            .update({ status: "in_progress", attempt, updated_at: nowIso })
            .eq("id", jobId)
            .eq("status", "queued")
            .select("id")
            .maybeSingle(); // Use maybeSingle to handle race conditions where job is already locked

        if (error) {
            console.error(`[publish-queue] failed to lock job ${jobId}`, error);
            return false;
        }
        return Boolean(data);
    }

    private async loadContent(contentItemId: string): Promise<ContentRow | null> {
        const { data, error } = await this.supabase
            .from("content_items")
            .select("id, account_id, platform, placement, scheduled_for, prompt_context, campaigns(name)")
            .eq("id", contentItemId)
            .maybeSingle<ContentRow>();

        if (error) {
            console.error(`[publish-queue] failed to load content item ${contentItemId}`, error);
            return null;
        }
        return data ?? null;
    }

    private async loadVariant(variantId: string): Promise<VariantRow | null> {
        const { data, error } = await this.supabase
            .from('content_variants')
            .select('id, content_item_id, body, media_ids')
            .eq('id', variantId)
            .maybeSingle<VariantRow>();

        if (error) {
            console.error(`[publish-queue] failed to load variant ${variantId}`, error);
            return null;
        }
        return data ?? null;
    }

    private async loadConnection(accountId: string, platform: ProviderPlatform) {
        const { data, error } = await this.supabase
            .from("social_connections")
            .select("id, provider, status, access_token, refresh_token, expires_at, display_name, metadata")
            .eq("account_id", accountId)
            .eq("provider", platform)
            .maybeSingle<ConnectionRow>();

        if (error) {
            console.error(`[publish-queue] failed to load connection`, error);
            return null;
        }
        return data ?? null;
    }

    private async loadMedia(mediaIds: string[], placement: ProviderPlacement) {
        if (!mediaIds.length) return [];

        const { data, error } = await this.supabase
            .from("media_assets")
            .select("id, storage_path, media_type, mime_type, derived_variants, processed_status")
            .in("id", mediaIds)
            .returns<MediaRow[]>();

        if (error) {
            console.error("[publish-queue] failed to fetch media assets", error);
            throw error;
        }

        const mediaRows = data ?? [];
        if (!mediaRows.length) {
            throw new Error("Media assets not found");
        }

        if (placement === "story" && mediaRows.length !== 1) {
            throw new Error("Stories require exactly one image asset");
        }

        const pathByMedia = new Map<string, string>();
        for (const row of mediaRows) {
            let targetPath = row.storage_path;
            // Normalise path removal of bucket prefix handled by storage API usage?
            // Original code did: if (path.startsWith(`${MEDIA_BUCKET}/`)) ...
            if (targetPath.startsWith(`${this.config.mediaBucket}/`)) {
                targetPath = targetPath.slice(this.config.mediaBucket.length + 1);
            }

            if (placement === "story") {
                if (row.media_type !== "image") {
                    throw new Error("Stories support images only");
                }
                // resolveDerivedPath logic inline
                const vars = row.derived_variants as Record<string, unknown> | null;
                const storyVariant = (vars?.story && typeof vars.story === "string") ? vars.story : null;

                if (!storyVariant) {
                    const derivativeError: Error & { mediaId?: string; code?: string } = new Error("Story derivative not available for selected media");
                    derivativeError.mediaId = row.id;
                    derivativeError.code = "STORY_DERIVATIVE_MISSING";
                    throw derivativeError;
                }

                targetPath = storyVariant;
                if (targetPath.startsWith(`${this.config.mediaBucket}/`)) {
                    targetPath = targetPath.slice(this.config.mediaBucket.length + 1);
                }
            }

            pathByMedia.set(row.id, targetPath);
        }

        const uniquePaths = Array.from(new Set(pathByMedia.values()));
        const { data: signed, error: signedError } = await this.supabase.storage
            .from(this.config.mediaBucket)
            .createSignedUrls(uniquePaths, this.config.mediaSignedUrlTtlSeconds);

        if (signedError) {
            console.error("[publish-queue] failed to create signed URLs", signedError);
            throw signedError;
        }

        const urlMap = new Map<string, string>();
        for (const entry of signed ?? []) {
            if (entry.error || !entry.signedUrl) {
                console.error("[publish-queue] missing signed URL", entry);
                continue;
            }
            urlMap.set(entry.path, entry.signedUrl);
        }

        return mediaRows.map<ProviderMedia>((row) => {
            const normalisedPath = pathByMedia.get(row.id);
            if (!normalisedPath) throw new Error(`Path missing for media asset ${row.id}`);

            const signedUrl = urlMap.get(normalisedPath);
            if (!signedUrl) throw new Error(`Signed URL missing for media asset ${row.id}`);

            return {
                id: row.id,
                url: signedUrl,
                mediaType: row.media_type,
                mimeType: row.mime_type,
            };
        });
    }

    private async logDbContext(label: string, jobId: string, attempt: number) {
        try {
            const { data, error } = await this.supabase.rpc('inspect_worker_db_context');
            if (error) throw error;
            const contextRow = Array.isArray(data) ? data[0] : data;
            if (contextRow) {
                console.info('[publish-queue] db-context', { label, jobId, attempt, ...contextRow });
            }
        } catch (contextError) {
            console.warn(`[publish-queue] failed to capture db context for job ${jobId}`, contextError);
        }
    }

    private async scheduleVariantRetry({
        job,
        content,
        attempt,
        now,
    }: {
        job: PublishJobRow;
        content: ContentRow;
        attempt: number;
        now: Date;
    }) {
        const nowIso = now.toISOString();
        const delayMs = Math.max(5, this.config.retries.variantRetryDelaySeconds) * 1000;
        const nextAttemptAt = new Date(now.getTime() + delayMs).toISOString();

        const deferMessage = 'Awaiting content variant availability';

        const { error: jobError } = await this.supabase
            .from('publish_jobs')
            .update({
                status: 'queued',
                last_error: deferMessage,
                next_attempt_at: nextAttemptAt,
                updated_at: nowIso,
            })
            .eq('id', job.id);

        if (jobError) {
            console.error(`[publish-queue] failed to defer job ${job.id} for variant retry`, jobError);
        }

        await this.markContentStatus(content.id, 'scheduled', nowIso);
        await this.logDbContext('variant_retry_scheduled', job.id, attempt);

        const retryCategory = content.placement === 'story' ? 'story_publish_retry' : 'publish_retry';
        await this.insertNotification(
            content.account_id,
            retryCategory,
            `Waiting for ${content.platform} ${content.placement} to become available`,
            {
                jobId: job.id,
                attempt,
                nextAttemptAt,
                contentId: content.id,
                platform: content.platform,
                placement: content.placement,
            },
        );
    }

    private async scheduleDerivativeRetry({
        job,
        content,
        attempt,
        now,
        message,
        mediaId,
    }: {
        job: PublishJobRow;
        content: ContentRow;
        attempt: number;
        now: Date;
        message: string;
        mediaId?: string;
    }) {
        const nowIso = now.toISOString();
        const delayMs = Math.max(5, this.config.retries.variantRetryDelaySeconds) * 1000;
        const nextAttemptAt = new Date(now.getTime() + delayMs).toISOString();

        const deferMessage = mediaId
            ? `Awaiting story derivative for media ${mediaId}`
            : "Awaiting story derivative availability";

        const { error: jobError } = await this.supabase
            .from("publish_jobs")
            .update({
                status: "queued",
                last_error: message,
                next_attempt_at: nextAttemptAt,
                updated_at: nowIso,
            })
            .eq("id", job.id);

        if (jobError) {
            console.error(`[publish-queue] failed to defer job ${job.id} for derivative retry`, jobError);
        }

        await this.markContentStatus(content.id, "scheduled", nowIso);
        await this.logDbContext("derivative_retry_scheduled", job.id, attempt);

        const retryCategory = content.placement === "story" ? "story_publish_retry" : "publish_retry";
        await this.insertNotification(
            content.account_id,
            retryCategory,
            deferMessage,
            {
                jobId: job.id,
                attempt,
                nextAttemptAt,
                contentId: content.id,
                platform: content.platform,
                placement: content.placement,
                mediaId,
                error: message,
            },
        );
    }

    private async markJobSucceeded(jobId: string, providerResponse: ProviderPublishResult, nowIso: string) {
        const { error } = await this.supabase
            .from("publish_jobs")
            .update({
                status: "succeeded",
                provider_response: providerResponse,
                last_error: null,
                next_attempt_at: null,
                updated_at: nowIso,
            })
            .eq("id", jobId);

        if (error) {
            console.error(`[publish-queue] failed to mark job ${jobId} succeeded`, error);
        }
    }

    private async markContentStatus(contentId: string, status: ContentStatus, nowIso: string) {
        const { error } = await this.supabase
            .from("content_items")
            .update({ status, updated_at: nowIso })
            .eq("id", contentId);

        if (error) {
            console.error(`[publish-queue] failed to update content ${contentId} status to ${status}`, error);
        }
    }

    private async handleFailure({
        jobId,
        content,
        attempt,
        now,
        message,
        retryable,
    }: {
        jobId: string;
        content: ContentRow;
        attempt: number;
        now: Date;
        message: string;
        retryable: boolean;
    }) {
        const nowIso = now.toISOString();
        const allowPlacementRetry = content.placement === "feed";
        const shouldRetry = allowPlacementRetry && retryable && attempt < this.config.retries.maxAttempts;

        if (shouldRetry) {
            const delayMinutes = this.getBackoffMinutes(attempt);
            const nextAttemptAt = new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString();

            const { error: jobError } = await this.supabase
                .from("publish_jobs")
                .update({
                    status: "queued",
                    last_error: message,
                    next_attempt_at: nextAttemptAt,
                    updated_at: nowIso,
                })
                .eq("id", jobId);

            if (jobError) {
                console.error(`[publish-queue] failed to reschedule job ${jobId}`, jobError);
            }

            await this.markContentStatus(content.id, "scheduled", nowIso);

            const retryCategory = content.placement === "story" ? "story_publish_retry" : "publish_retry";
            await this.insertNotification(
                content.account_id,
                retryCategory,
                `Retrying ${content.platform} ${content.placement} in ${delayMinutes} minute(s)`,
                {
                    jobId,
                    attempt,
                    nextAttemptAt,
                    error: message,
                    contentId: content.id,
                    platform: content.platform,
                    placement: content.placement,
                },
            );
            return;
        }

        const { error: jobError } = await this.supabase
            .from("publish_jobs")
            .update({
                status: "failed",
                last_error: message,
                next_attempt_at: null,
                updated_at: nowIso,
            })
            .eq("id", jobId);

        if (jobError) {
            console.error(`[publish-queue] failed to mark job ${jobId} failed`, jobError);
        }

        await this.markContentStatus(content.id, "failed", nowIso);

        const failureCategory = content.placement === "story" ? "story_publish_failed" : "publish_failed";
        await this.insertNotification(content.account_id, failureCategory, `Posting to ${content.platform} failed`, {
            jobId,
            attempt,
            error: message,
            contentId: content.id,
            platform: content.platform,
            placement: content.placement,
        });
    }

    private async forceConnectionNeedsAction(
        connection: ConnectionRow,
        accountId: string,
        reason: string,
        nowIso: string,
    ) {
        if (connection.status === "needs_action") {
            return;
        }

        const { error } = await this.supabase
            .from("social_connections")
            .update({ status: "needs_action", updated_at: nowIso })
            .eq("id", connection.id);

        if (error) {
            console.error(`[publish-queue] failed to flag connection ${connection.id}`, error);
            return;
        }

        await this.insertNotification(
            accountId,
            "connection_needs_action",
            `${connection.display_name ?? connection.provider} needs to be reconnected`,
            {
                connectionId: connection.id,
                provider: connection.provider,
                reason,
            },
        );
    }

    private async insertNotification(
        accountId: string,
        category: string,
        message: string,
        metadata?: Record<string, unknown>,
    ) {
        const { error } = await this.supabase
            .from("notifications")
            .insert({
                account_id: accountId,
                category,
                message,
                metadata: metadata ?? null,
            });

        if (error) {
            console.error("[publish-queue] failed to insert notification", error);
        }
    }

    private async markJobMissingContent(jobId: string, nowIso: string) {
        const { error } = await this.supabase
            .from("publish_jobs")
            .update({
                status: "failed",
                last_error: "Content item missing",
                next_attempt_at: null,
                updated_at: nowIso,
            })
            .eq("id", jobId);

        if (error) {
            console.error(`[publish-queue] failed to mark job ${jobId} missing content`, error);
        }
    }

    private extractErrorMessage(error: unknown) {
        if (error instanceof Error && typeof error.message === "string") {
            return error.message;
        }
        if (typeof error === "string") {
            return error;
        }
        try {
            return JSON.stringify(error);
        } catch {
            return "Unknown error";
        }
    }
}

```

### Connection metadata resolver
`supabase/functions/publish-queue/metadata.ts`
```ts
export type ProviderPlatform = "facebook" | "instagram" | "gbp";

export interface ConnectionMetadataResolution {
  ok: true;
  metadata: Record<string, unknown>;
}

export interface ConnectionMetadataError {
  ok: false;
  error: string;
}

interface SourceMetadata {
  pageId?: unknown;
  igBusinessId?: unknown;
  igUserId?: unknown;
  locationId?: unknown;
}

export function resolveConnectionMetadata(
  provider: ProviderPlatform,
  metadata: Record<string, unknown> | null,
): ConnectionMetadataResolution | ConnectionMetadataError {
  const raw = (metadata ?? {}) as SourceMetadata;
  const result: Record<string, unknown> = {};

  const ensureString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  switch (provider) {
    case "facebook": {
      const pageId = ensureString(raw.pageId);
      if (!pageId) {
        return { ok: false, error: "Facebook connection missing pageId metadata." };
      }
      result.pageId = pageId;
      break;
    }
    case "instagram": {
      const igBusinessId = ensureString(raw.igBusinessId ?? raw.igUserId);
      if (!igBusinessId) {
        return { ok: false, error: "Instagram connection missing igBusinessId metadata." };
      }
      result.igBusinessId = igBusinessId;
      break;
    }
    case "gbp": {
      const locationId = ensureString(raw.locationId);
      if (!locationId) {
        return { ok: false, error: "Google Business connection missing locationId metadata." };
      }
      result.locationId = locationId;
      break;
    }
    default:
      return { ok: true, metadata: {} };
  }

  return { ok: true, metadata: result };
}

```

### Provider adapter types
`supabase/functions/publish-queue/providers/types.ts`
```ts
export type ProviderPlatform = "facebook" | "instagram" | "gbp";
export type ProviderPlacement = "feed" | "story";

export interface ProviderMedia {
  id: string;
  url: string;
  mediaType: "image" | "video";
  mimeType?: string | null;
}

export interface ProviderPublishPayload {
  body: string;
  media: ProviderMedia[];
  scheduledFor?: string | null;
  campaignName?: string | null;
  promptContext?: Record<string, unknown> | null;
  placement: ProviderPlacement;
}

export interface ProviderAuthContext {
  connectionId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
}

export interface ProviderPublishRequest {
  payload: ProviderPublishPayload;
  auth: ProviderAuthContext;
  accountId: string;
  contentId: string;
  attempt: number;
  connectionMetadata: Record<string, unknown> | null;
  placement: ProviderPlacement;
}

export interface ProviderPublishResult {
  platform: ProviderPlatform;
  externalId: string;
  payloadPreview: string;
  publishedAt: string;
  rawResponse?: unknown;
}

```

### Provider adapter - Facebook
`supabase/functions/publish-queue/providers/facebook.ts`
```ts
// @ts-nocheck
import type { ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function parseFacebookResponse(response: Response) {
  const clone = response.clone();
  try {
    return await response.json();
  } catch {
    try {
      const text = await clone.text();
      return text.length ? text : null;
    } catch {
      return null;
    }
  }
}

export async function publishToFacebook({
  payload,
  auth,
  connectionMetadata,
  placement,
}: ProviderPublishRequest): Promise<ProviderPublishResult> {
  if (!auth.accessToken) {
    throw new Error("Missing Facebook access token");
  }

  const pageId = typeof connectionMetadata?.pageId === "string" ? connectionMetadata.pageId : "";
  if (!pageId) {
    throw new Error("Facebook pageId metadata missing");
  }

  if (placement === "story") {
    if (!payload.media.length) {
      throw new Error("Facebook stories require an image attachment");
    }

    const media = payload.media[0];
    if (media.mediaType !== "image") {
      throw new Error("Facebook stories currently support images only");
    }

    // Fetch the story image bytes so we can upload via multipart/form-data
    const mediaResponse = await fetch(media.url, { method: "GET" });
    if (!mediaResponse.ok) {
      throw new Error(
        `[facebook_story_fetch] status=${mediaResponse.status} message=Unable to fetch media from storage`,
      );
    }

    const contentType = mediaResponse.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const fileName = extractFileName(media.url);
    const file = new File([new Uint8Array(arrayBuffer)], fileName, { type: contentType });

    // Step 1: upload the photo as unpublished content
    const uploadUrl = `${GRAPH_BASE}/${pageId}/photos?access_token=${auth.accessToken}`;
    const uploadForm = new FormData();
    uploadForm.set("published", "false");
    uploadForm.set("source", file);

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      body: uploadForm,
    });
    const uploadTraceId = uploadResponse.headers.get("x-fb-trace-id") ?? null;
    const uploadText = await uploadResponse.text();
    console.info("[facebook] story upload payload", {
      uploadUrl,
      status: uploadResponse.status,
      traceId: uploadTraceId,
      body: uploadText.slice(0, 500),
    });
    const uploadJson = await safeJsonResponse(uploadText);
    if (!uploadResponse.ok) {
      const formatted = formatGraphError(uploadJson ?? uploadText);
      throw new Error(
        `[facebook_story_upload] status=${uploadResponse.status} message=${formatted} trace=${uploadTraceId ?? "n/a"}`,
      );
    }

    const photoId =
      uploadJson && typeof uploadJson === "object"
        ? (uploadJson as Record<string, unknown>).id
        : undefined;
    if (typeof photoId !== "string" || !photoId.length) {
      throw new Error("Facebook story upload response missing photo id");
    }

    // Step 2: publish the story referencing the uploaded photo
    const publishUrl = `${GRAPH_BASE}/${pageId}/photo_stories?access_token=${auth.accessToken}`;
    const publishForm = new FormData();
    publishForm.set("photo_id", photoId);

    const response = await fetch(publishUrl, {
      method: "POST",
      body: publishForm,
    });
    const traceId = response.headers.get("x-fb-trace-id") ?? null;
    const responseText = await response.text();
    console.info("[facebook] story publish payload", {
      publishUrl,
      status: response.status,
      traceId,
      body: responseText.slice(0, 500),
    });
    const rawResponse = await safeJsonResponse(responseText);
    if (!response.ok) {
      const formatted = formatGraphError(rawResponse ?? responseText);
      throw new Error(
        `[facebook_story] status=${response.status} message=${formatted} trace=${traceId ?? "n/a"}`,
      );
    }

    const storyId = resolveStoryExternalId(rawResponse, photoId);
    if (!storyId) {
      throw new Error("Facebook story response missing id");
    }

    return {
      platform: "facebook",
      externalId: storyId,
      payloadPreview: "Facebook story image",
      publishedAt: new Date().toISOString(),
      rawResponse,
    };
  }

  const message = payload.body.trim();
  const hasMedia = payload.media.length > 0;
  let rawResponse: unknown;
  let externalId = "";

  if (hasMedia && payload.media[0]?.mediaType === "image") {
    const media = payload.media[0];
    const publishUrl = `${GRAPH_BASE}/${pageId}/photos`;
    const params = new URLSearchParams({
      url: media.url,
      caption: message,
      published: "true",
      access_token: auth.accessToken,
    });

    const response = await fetch(publishUrl, {
      method: "POST",
      body: params,
    });

    rawResponse = await parseFacebookResponse(response);
    if (!response.ok) {
      throw new Error(formatGraphError(rawResponse));
    }

    const postId = (rawResponse as Record<string, unknown>).post_id ?? (rawResponse as Record<string, unknown>).id;
    if (typeof postId !== "string" || !postId.length) {
      throw new Error("Facebook response missing post identifier");
    }
    externalId = postId;
  } else {
    const feedUrl = `${GRAPH_BASE}/${pageId}/feed`;
    const params = new URLSearchParams({
      message,
      access_token: auth.accessToken,
    });

    const response = await fetch(feedUrl, {
      method: "POST",
      body: params,
    });

    rawResponse = await parseFacebookResponse(response);
    if (!response.ok) {
      throw new Error(formatGraphError(rawResponse));
    }

    const postId = (rawResponse as Record<string, unknown>).id;
    if (typeof postId !== "string" || !postId.length) {
      throw new Error("Facebook response missing post identifier");
    }
    externalId = postId;
  }

  return {
    platform: "facebook",
    externalId,
    payloadPreview: message.slice(0, 140),
    publishedAt: new Date().toISOString(),
    rawResponse,
  };
}

async function safeJsonResponse(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function formatGraphError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } }).error;
    const message = err?.message ?? "Unknown error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Facebook publishing failed";
}

function extractFileName(url: string) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "story.jpg";
    if (last.includes(".")) {
      return last;
    }
    return `${last}.jpg`;
  } catch {
    return "story.jpg";
  }
}

function resolveStoryExternalId(payload: unknown, fallbackPhotoId: string) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.id, record.post_id, record.story_id];
  for (const value of candidates) {
    if (typeof value === "string" && value.length) {
      return value;
    }
  }

  if (record.success === true && fallbackPhotoId) {
    return fallbackPhotoId;
  }

  return null;
}

```

### Provider adapter - Instagram
`supabase/functions/publish-queue/providers/instagram.ts`
```ts
// @ts-nocheck
import type { ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MEDIA_STATUS_FIELDS = "status_code,status";
const MEDIA_STATUS_POLL_DELAY_MS = Number(Deno.env.get("INSTAGRAM_STATUS_DELAY_MS") ?? 2000);
const MEDIA_STATUS_MAX_ATTEMPTS = Number(Deno.env.get("INSTAGRAM_STATUS_MAX_ATTEMPTS") ?? 10);

export async function publishToInstagram({
  payload,
  auth,
  connectionMetadata,
  placement,
}: ProviderPublishRequest): Promise<ProviderPublishResult> {
  if (!auth.accessToken) {
    throw new Error("Missing Instagram access token");
  }

  if (!payload.media.length) {
    throw new Error("Instagram requires an image attachment for publishing");
  }

  const image = payload.media[0];
  if (image.mediaType !== "image") {
    throw new Error("Instagram publishing currently supports images only");
  }

  const igBusinessId = typeof connectionMetadata?.igBusinessId === "string"
    ? connectionMetadata.igBusinessId
    : "";
  if (!igBusinessId) {
    throw new Error("Instagram igBusinessId metadata missing");
  }

  const caption = placement === "story" ? "" : payload.body.trim();

  const createUrl = `${GRAPH_BASE}/${igBusinessId}/media`;
  const createParams = new URLSearchParams({
    image_url: image.url,
    access_token: auth.accessToken,
  });

  if (placement === "story") {
    createParams.set("media_type", "STORIES");
  } else if (caption) {
    createParams.set("caption", caption);
  }

  const createResponse = await fetch(createUrl, {
    method: "POST",
    body: createParams,
  });

  const createJson = await safeJson(createResponse);
  if (!createResponse.ok) {
    throw new Error(formatGraphError(createJson));
  }

  const creationId = createJson?.id;
  if (typeof creationId !== "string" || !creationId.length) {
    throw new Error("Instagram response missing creation id");
  }

  const publishUrl = `${GRAPH_BASE}/${igBusinessId}/media_publish`;
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: auth.accessToken,
  });

  await waitForMediaReady(creationId, auth.accessToken);

  const publishResponse = await fetch(publishUrl, {
    method: "POST",
    body: publishParams,
  });

  const publishJson = await safeJson(publishResponse);
  if (!publishResponse.ok) {
    throw new Error(formatGraphError(publishJson));
  }

  const externalId = publishJson?.id;
  if (typeof externalId !== "string" || !externalId.length) {
    throw new Error("Instagram publish response missing id");
  }

  return {
    platform: "instagram",
    externalId,
    payloadPreview: placement === "story" ? "Instagram story image" : caption.slice(0, 140),
    publishedAt: new Date().toISOString(),
    rawResponse: publishJson,
  };
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatGraphError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in (payload as Record<string, unknown>)) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } }).error;
    const message = err?.message ?? "Unknown error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Instagram publishing failed";
}

async function waitForMediaReady(creationId: string, accessToken: string) {
  const statusUrl = `${GRAPH_BASE}/${creationId}?fields=${MEDIA_STATUS_FIELDS}&access_token=${accessToken}`;

  for (let attempt = 0; attempt < MEDIA_STATUS_MAX_ATTEMPTS; attempt += 1) {
    const statusResponse = await fetch(statusUrl);
    const statusJson = await safeJson(statusResponse);

    if (!statusResponse.ok) {
      throw new Error(formatGraphError(statusJson));
    }

    const statusCode = typeof statusJson?.status_code === "string" ? statusJson.status_code : null;
    const status = typeof statusJson?.status === "string" ? statusJson.status : null;

    if (statusCode === "ERROR" || status === "ERROR") {
      const detail = typeof statusJson?.status === "string" ? statusJson.status : "Instagram media failed to process";
      throw new Error(detail);
    }

    if (statusCode === "FINISHED" || statusCode === "READY" || status === "FINISHED" || status === "READY") {
      return;
    }

    await delay(MEDIA_STATUS_POLL_DELAY_MS);
  }

  throw new Error("Instagram media container did not become ready in time");
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

```

### Provider adapter - Google Business Profile
`supabase/functions/publish-queue/providers/gbp.ts`
```ts
// @ts-nocheck
import type { ProviderMedia, ProviderPublishRequest, ProviderPublishResult } from "./types.ts";

const GBP_BASE = "https://mybusiness.googleapis.com/v4";

export async function publishToGBP({
  payload,
  auth,
  connectionMetadata,
  placement,
}: ProviderPublishRequest): Promise<ProviderPublishResult> {
  if (placement !== "feed") {
    throw new Error("Google Business Profile does not support stories");
  }

  if (!auth.accessToken) {
    throw new Error("Missing GBP access token");
  }

  const locationId = typeof connectionMetadata?.locationId === "string" ? connectionMetadata.locationId : "";
  if (!locationId) {
    throw new Error("Google Business locationId metadata missing");
  }

  const summary = truncateSummary(payload.body);
  const requestBody: Record<string, unknown> = {
    languageCode: "en-GB",
    summary,
    topicType: "STANDARD",
  };

  const mediaAttachments = buildMediaAttachments(payload.media);
  if (mediaAttachments.length) {
    requestBody.media = mediaAttachments;
  }

  const postUrl = `${GBP_BASE}/${locationId}/localPosts`;
  const response = await fetch(postUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  const rawResponse = await safeJson(response);
  if (!response.ok) {
    throw new Error(formatGbpError(rawResponse));
  }

  const name = rawResponse?.name;
  if (typeof name !== "string" || !name.length) {
    throw new Error("GBP response missing post name");
  }

  return {
    platform: "gbp",
    externalId: name,
    payloadPreview: summary.slice(0, 140),
    publishedAt: new Date().toISOString(),
    rawResponse,
  };
}

function truncateSummary(body: string) {
  const trimmed = body.trim();
  return trimmed.length > 1500 ? `${trimmed.slice(0, 1497)}...` : trimmed;
}

function buildMediaAttachments(media: ProviderMedia[]) {
  return media
    .filter((item) => item.mediaType === "image")
    .map((item) => ({
      mediaFormat: "PHOTO",
      sourceUrl: item.url,
    }));
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatGbpError(payload: unknown) {
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: { status?: string; message?: string } }).error;
    if (err) {
      const status = err.status ? `${err.status}: ` : "";
      return `${status}${err.message ?? "Unknown error"}`;
    }
  }
  return "Google Business publishing failed";
}

```

### enqueuePublishJob helper
`src/lib/publishing/queue.ts`
```ts
import { createServiceSupabaseClient } from "@/lib/supabase/service";

interface EnqueuePublishJobOptions {
  contentItemId: string;
  variantId?: string | null;
  placement?: "feed" | "story";
  scheduledFor: Date | null;
}

export async function enqueuePublishJob({
  contentItemId,
  variantId,
  placement,
  scheduledFor,
}: EnqueuePublishJobOptions) {
  const supabase = createServiceSupabaseClient();

  let resolvedPlacement = placement ?? null;
  if (!resolvedPlacement || !variantId) {
    const { data: itemRow, error: itemError } = await supabase
      .from("content_items")
      .select("placement")
      .eq("id", contentItemId)
      .maybeSingle<{ placement: "feed" | "story" }>();

    if (itemError) {
      throw itemError;
    }

    resolvedPlacement = resolvedPlacement ?? itemRow?.placement ?? "feed";
  }

  let resolvedVariantId = variantId ?? null;
  if (!resolvedVariantId) {
    const { data: variantRow, error: variantError } = await supabase
      .from("content_variants")
      .select("id")
      .eq("content_item_id", contentItemId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (variantError) {
      throw variantError;
    }

    if (!variantRow) {
      throw new Error("No variant found for content item");
    }

    resolvedVariantId = variantRow.id;
  }

  const nowIso = new Date().toISOString();
  const nextAttempt = scheduledFor ? scheduledFor.toISOString() : nowIso;

  await supabase
    .from("publish_jobs")
    .insert({
      content_item_id: contentItemId,
      variant_id: resolvedVariantId,
      status: "queued",
      next_attempt_at: nextAttempt,
      placement: resolvedPlacement,
    })
    .throwOnError();
}

export async function markContentScheduled(
  contentItemIds: string[],
  status: "scheduled" | "queued",
) {
  if (!contentItemIds.length) return;
  const supabase = createServiceSupabaseClient();

  await supabase
    .from("content_items")
    .update({ status })
    .in("id", contentItemIds)
    .throwOnError();
}

```

### Planner actions (approval, reschedule, enqueue)
`src/app/(app)/planner/actions.ts`
```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DateTime } from "luxon";

import { enqueuePublishJob } from "@/lib/publishing/queue";
import { assertPublishReadiness } from "@/lib/publishing/preflight";
import { requireAuthContext } from "@/lib/auth/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

const approveSchema = z.object({
  contentId: z.string().uuid(),
});

const dismissSchema = z.object({
  notificationId: z.string().uuid(),
});

const deleteSchema = z.object({
  contentId: z.string().uuid(),
});

const restoreSchema = z.object({
  contentId: z.string().uuid(),
});

const permanentDeleteSchema = z.object({
  contentId: z.string().uuid(),
});

const updateMediaSchema = z.object({
  contentId: z.string().uuid(),
  media: z
    .array(
      z.object({
        assetId: z.string().uuid(),
      }),
    )
    .min(1, "At least one media asset required"),
});

const updateBodySchema = z.object({
  contentId: z.string().uuid(),
  body: z.string().max(10_000, "Keep the post under 10k characters"),
});

const updateScheduleSchema = z.object({
  contentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Provide a date in YYYY-MM-DD format"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Provide a time in HH:MM format"),
});

const createSchema = z.object({
  platform: z.enum(["facebook", "instagram", "gbp"]),
  placement: z.enum(["feed", "story"]),
});


export async function approveDraftContent(payload: unknown) {
  const { contentId } = approveSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error } = await supabase
    .from("content_items")
    .select("id, status, scheduled_for, account_id, placement, platform")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (content.status !== "draft") {
    revalidatePath("/planner");
    return { status: content.status, scheduledFor: content.scheduled_for ?? null } as const;
  }

  await assertPublishReadiness({
    supabase,
    accountId,
    contentId,
    platform: content.platform,
    placement: content.placement ?? "feed",
  });

  const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ status: "scheduled", updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  const { data: existingJob } = await supabase
    .from("publish_jobs")
    .select("id")
    .eq("content_item_id", contentId)
    .limit(1)
    .maybeSingle();

  if (!existingJob) {
    const { data: variantRow, error: variantError } = await supabase
      .from("content_variants")
      .select("id")
      .eq("content_item_id", contentId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (variantError) {
      throw variantError;
    }

    if (!variantRow) {
      throw new Error("Variant missing for content item");
    }

    await enqueuePublishJob({
      contentItemId: contentId,
      variantId: variantRow.id,
      placement: content.placement ?? undefined,
      scheduledFor,
    });
  }

  const scheduledIso = scheduledFor ? scheduledFor.toISOString() : null;

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_approved",
      message: scheduledIso
        ? `Draft approved and scheduled for ${new Date(scheduledIso).toLocaleString()}`
        : "Draft approved and queued to publish",
      metadata: {
        contentId,
        scheduledFor: scheduledIso,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert approval notification", notificationError);
  }

  revalidatePath("/planner");

  return {
    status: "scheduled" as const,
    scheduledFor: scheduledIso,
  };
}

export async function dismissPlannerNotification(payload: unknown) {
  const { notificationId } = dismissSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("id", notificationId)
    .eq("account_id", accountId);

  if (error) {
    throw error;
  }

  revalidatePath("/planner");

  return {
    ok: true as const,
    notificationId,
    readAt: nowIso,
  };
}

export async function deletePlannerContent(payload: unknown) {
  const { contentId } = deleteSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status, scheduled_for, placement, deleted_at")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (content.deleted_at) {
    return {
      ok: true as const,
      contentId,
      deletedAt: content.deleted_at,
    };
  }

  const deletedAtIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ deleted_at: deletedAtIso, updated_at: deletedAtIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  const { error: jobError } = await supabase
    .from("publish_jobs")
    .delete()
    .eq("content_item_id", contentId);

  if (jobError) {
    throw jobError;
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_deleted",
      message: "Post moved to trash",
      metadata: {
        contentId,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert delete notification", notificationError);
  }

  revalidatePath("/planner");
  revalidatePath("/library");

  return {
    ok: true as const,
    contentId,
    deletedAt: deletedAtIso,
  };
}

export async function updatePlannerContentMedia(payload: unknown) {
  const { contentId, media } = updateMediaSchema.parse(payload);
  if (!media.length) {
    throw new Error("Attach at least one media asset");
  }

  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: fetchError } = await supabase
    .from("content_items")
    .select("id, account_id, placement")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  const mediaIds = media.map((item) => item.assetId);

  if (content.placement === "story") {
    if (mediaIds.length !== 1) {
      throw new Error("Stories require exactly one media attachment");
    }

    const { data: assets, error: assetError } = await supabase
      .from("media_assets")
      .select("id, media_type, derived_variants")
      .in("id", mediaIds)
      .returns<Array<{ id: string; media_type: string; derived_variants: Record<string, unknown> | null }>>();

    if (assetError) {
      throw assetError;
    }

    const asset = assets?.[0];
    if (!asset || asset.media_type !== "image") {
      throw new Error("Stories support images only");
    }

    const storyVariant = asset.derived_variants?.story;
    if (typeof storyVariant !== "string" || !storyVariant.length) {
      throw new Error("Selected media is still processing story derivatives. Try again once ready.");
    }
  }

  const { error: variantError } = await supabase
    .from("content_variants")
    .upsert(
      {
        content_item_id: contentId,
        media_ids: mediaIds,
      },
      { onConflict: "content_item_id" },
    );

  if (variantError) {
    throw variantError;
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("content_items")
    .update({ updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    contentId,
    mediaIds,
  };
}

export async function restorePlannerContent(payload: unknown) {
  const { contentId } = restoreSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, status, scheduled_for, placement, deleted_at")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (!content.deleted_at) {
    return {
      ok: true as const,
      status: content.status,
      scheduledFor: content.scheduled_for ?? null,
    };
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("content_items")
    .update({ deleted_at: null, updated_at: nowIso })
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  if (content.status === "scheduled" || content.status === "publishing") {
    const { data: existingJob } = await supabase
      .from("publish_jobs")
      .select("id")
      .eq("content_item_id", contentId)
      .limit(1)
      .maybeSingle();

    if (!existingJob) {
      const { data: variantRow, error: variantError } = await supabase
        .from("content_variants")
        .select("id")
        .eq("content_item_id", contentId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (variantError) {
        throw variantError;
      }

      if (!variantRow) {
        throw new Error("Variant missing for content item");
      }

      const scheduledFor = content.scheduled_for ? new Date(content.scheduled_for) : null;

      await enqueuePublishJob({
        contentItemId: contentId,
        variantId: variantRow.id,
        placement: content.placement ?? undefined,
        scheduledFor,
      });
    }
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_restored",
      message: "Post restored from trash",
      metadata: {
        contentId,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert restore notification", notificationError);
  }

  revalidatePath("/planner");
  revalidatePath("/library");

  return {
    ok: true as const,
    status: content.status,
    scheduledFor: content.scheduled_for ?? null,
  };
}

export async function permanentlyDeletePlannerContent(payload: unknown) {
  const { contentId } = permanentDeleteSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentFetchError } = await supabase
    .from("content_items")
    .select("id, account_id, deleted_at")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (contentFetchError) {
    throw contentFetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (!content.deleted_at) {
    throw new Error("Only items in trash can be deleted permanently.");
  }

  const { error: jobError } = await supabase
    .from("publish_jobs")
    .delete()
    .eq("content_item_id", contentId);

  if (jobError) {
    throw jobError;
  }

  const { error: deleteError } = await supabase
    .from("content_items")
    .delete()
    .eq("id", contentId)
    .eq("account_id", accountId);

  if (deleteError) {
    throw deleteError;
  }

  const { error: notificationError } = await supabase
    .from("notifications")
    .insert({
      account_id: accountId,
      category: "content_deleted_permanently",
      message: "Post deleted permanently",
      metadata: {
        contentId,
      },
    });

  if (notificationError) {
    console.error("[planner] failed to insert permanent delete notification", notificationError);
  }

  revalidatePath("/planner");
  revalidatePath("/library");

  return {
    ok: true as const,
    contentId,
  };
}

export async function updatePlannerContentBody(payload: unknown) {
  const { contentId, body } = updateBodySchema.parse(payload);
  const trimmedBody = body.trim();

  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: fetchError } = await supabase
    .from("content_items")
    .select("id, account_id, placement")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  const requiresBody = content.placement !== "story";
  if (requiresBody && !trimmedBody.length) {
    throw new Error("Write something before saving.");
  }

  const resolvedBody = requiresBody ? trimmedBody : "";

  const { data: existingVariant, error: variantFetchError } = await supabase
    .from("content_variants")
    .select("media_ids")
    .eq("content_item_id", contentId)
    .maybeSingle();

  if (variantFetchError) {
    throw variantFetchError;
  }

  if (existingVariant) {
    const { error: updateError } = await supabase
      .from("content_variants")
      .update({ body: resolvedBody })
      .eq("content_item_id", contentId);

    if (updateError) {
      throw updateError;
    }
  } else {
    const { error: insertError } = await supabase
      .from("content_variants")
      .insert({
        content_item_id: contentId,
        body: resolvedBody,
        media_ids: null,
      });

    if (insertError) {
      throw insertError;
    }
  }

  const nowIso = new Date().toISOString();
  const { error: contentUpdateError } = await supabase
    .from("content_items")
    .update({ updated_at: nowIso })
    .eq("id", contentId);

  if (contentUpdateError) {
    throw contentUpdateError;
  }

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    contentId,
    updatedAt: nowIso,
  };
}

export async function updatePlannerContentSchedule(payload: unknown) {
  const { contentId, date, time } = updateScheduleSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const { data: content, error: contentError } = await supabase
    .from("content_items")
    .select("id, status, placement, platform")
    .eq("id", contentId)
    .eq("account_id", accountId)
    .maybeSingle<{ id: string; status: string; placement: "feed" | "story"; platform: "facebook" | "instagram" | "gbp" }>();

  if (contentError) {
    throw contentError;
  }

  if (!content) {
    throw new Error("Content item not found");
  }

  if (["publishing", "posted"].includes(content.status)) {
    throw new Error("This post has already been processed and can no longer be rescheduled.");
  }

  const { data: accountRow, error: accountError } = await supabase
    .from("accounts")
    .select("timezone")
    .eq("id", accountId)
    .maybeSingle<{ timezone: string | null }>();

  if (accountError) {
    throw accountError;
  }

  const timezone = accountRow?.timezone ?? DEFAULT_TIMEZONE;
  const desiredSlot = DateTime.fromISO(`${date}T${time}`, { zone: timezone });

  if (!desiredSlot.isValid) {
    throw new Error("The provided date or time is invalid for your timezone.");
  }

  const nowSlot = DateTime.now().setZone(timezone).startOf("minute");
  const desiredStart = desiredSlot.startOf("minute");

  if (desiredStart < nowSlot) {
    throw new Error("That time has already passed. Choose a future time.");
  }

  const scheduledIso = desiredStart.toUTC().toISO();

  if (!scheduledIso) {
    throw new Error("Unable to determine a valid schedule time.");
  }

  await assertPublishReadiness({
    supabase,
    accountId,
    contentId,
    platform: content.platform,
    placement: content.placement ?? "feed",
  });

  const nowIso = new Date().toISOString();

  const contentUpdate: Record<string, unknown> = {
    scheduled_for: scheduledIso,
    updated_at: nowIso,
  };

  if (content.status !== "draft") {
    contentUpdate.status = "scheduled";
  }

  const { error: updateError } = await supabase
    .from("content_items")
    .update(contentUpdate)
    .eq("id", contentId);

  if (updateError) {
    throw updateError;
  }

  const { data: jobRows, error: jobUpdateError } = await supabase
    .from("publish_jobs")
    .update({
      status: "queued",
      next_attempt_at: scheduledIso,
      last_error: null,
      attempt: 0,
      updated_at: nowIso,
    })
    .eq("content_item_id", contentId)
    .select("id");

  if (jobUpdateError) {
    throw jobUpdateError;
  }

  if (!jobRows?.length) {
    const { data: variantRow, error: variantError } = await supabase
      .from("content_variants")
      .select("id")
      .eq("content_item_id", contentId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (variantError) {
      throw variantError;
    }

    if (!variantRow) {
      throw new Error("Variant missing for content item");
    }

    await enqueuePublishJob({
      contentItemId: contentId,
      variantId: variantRow.id,
      placement: content.placement ?? undefined,
      scheduledFor: new Date(scheduledIso),
    });
  }

  revalidatePath(`/planner/${contentId}`);
  revalidatePath("/planner");

  return {
    ok: true as const,
    scheduledFor: scheduledIso,
    timezone,
  };
}

export async function createPlannerContent(payload: unknown) {
  const { platform, placement } = createSchema.parse(payload);
  const { supabase, accountId } = await requireAuthContext();

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("content_items")
    .insert({
      account_id: accountId,
      platform,
      placement,
      status: "draft",
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  revalidatePath("/planner");

  return {
    ok: true as const,
    contentId: data.id,
  };
}

```

### Campaign creation and job enqueue (snippet)
`src/lib/create/service.ts`
```ts
async function createCampaignFromPlans({
  supabase,
  accountId,
  brand,
  venueName,
  name,
  type,
  metadata,
  plans,
  options,
  linkInBioUrl,
}: {
  supabase: SupabaseClient;
  accountId: string;
  brand: Awaited<ReturnType<typeof getOwnerSettings>>["brand"];
  venueName?: string;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  plans: VariantPlan[];
  options?: {
    autoSchedule?: boolean;
  };
  linkInBioUrl?: string | null;
}) {
  if (!plans.length) {
    throw new Error("Cannot create campaign without plans");
  }

  const variants = await buildVariants({ brand, venueName, plans });
  const shouldAutoSchedule = options?.autoSchedule ?? true;

  const { data: campaignRow, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      account_id: accountId,
      name,
      campaign_type: type,
      status: "scheduled",
      metadata,
      link_in_bio_url: linkInBioUrl ?? null,
    })
    .select("id")
    .single();

  if (campaignError) throw campaignError;

  const nowIso = new Date().toISOString();

  const contentRows = variants.map((variant) => ({
    campaign_id: campaignRow.id,
    account_id: accountId,
    platform: variant.platform,
    placement: variant.placement,
    scheduled_for: variant.scheduledFor ? variant.scheduledFor.toISOString() : nowIso,
    status: shouldAutoSchedule
      ? variant.scheduledFor
        ? "scheduled"
        : "queued"
      : "draft",
    prompt_context: variant.promptContext,
    auto_generated: true,
  }));

  const { data: insertedContent, error: contentError } = await supabase
    .from("content_items")
    .insert(contentRows)
    .select("id, platform");

  if (contentError) throw contentError;

  const variantPayloads = (insertedContent ?? []).map((content, index) => ({
    content_item_id: content.id,
    body: variants[index]?.body ?? "",
    media_ids: variants[index]?.mediaIds.length ? variants[index]?.mediaIds : null,
  }));

  const { data: upsertedVariants, error: variantError } = await supabase
    .from("content_variants")
    .upsert(variantPayloads, { onConflict: "content_item_id" })
    .select("id, content_item_id");

  if (variantError) throw variantError;

  const variantIdByContent = new Map<string, string>();
  for (const row of upsertedVariants ?? []) {
    variantIdByContent.set(row.content_item_id, row.id);
  }

  await Promise.all(
    (insertedContent ?? []).map((content, index) => {
      if (!shouldAutoSchedule) return Promise.resolve();
      const variantId = variantIdByContent.get(content.id);
      if (!variantId) {
        return Promise.reject(new Error(`Variant id missing for content ${content.id}`));
      }
      return enqueuePublishJob({
        contentItemId: content.id,
        variantId,
        placement: variants[index]?.placement ?? "feed",
        scheduledFor: variants[index]?.scheduledFor ?? null,
      });
    }),
  );

  const hasImmediate = variants.some((variant) => !variant.scheduledFor);
  const status = shouldAutoSchedule ? (hasImmediate ? "queued" : "scheduled") : "draft";
  const scheduledDates = variants
    .map((variant) => variant.scheduledFor?.getTime())
    .filter((timestamp): timestamp is number => Boolean(timestamp));
  const earliest = scheduledDates.length ? new Date(Math.min(...scheduledDates)).toISOString() : null;

  return {
    campaignId: campaignRow.id,
    contentItemIds: insertedContent?.map((row) => row.id) ?? [],
    status,
    scheduledFor: earliest,
  } as const;
}
```

### Publish readiness checks
`src/lib/publishing/preflight.ts`
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateConnectionMetadata } from "@/lib/connections/metadata";

type Provider = "facebook" | "instagram" | "gbp";
type Placement = "feed" | "story";

interface PublishReadinessIssue {
  code: string;
  message: string;
}

interface PublishReadinessParams {
  supabase: SupabaseClient;
  accountId: string;
  contentId: string;
  platform: Provider;
  placement: Placement;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

const METADATA_LABELS: Record<Provider, string> = {
  facebook: "Facebook Page ID",
  instagram: "Instagram Business Account ID",
  gbp: "Google Business Location ID",
};

export async function getPublishReadinessIssues({
  supabase,
  accountId,
  contentId,
  platform,
  placement,
}: PublishReadinessParams): Promise<PublishReadinessIssue[]> {
  const issues: PublishReadinessIssue[] = [];

  const connection = await loadConnection({ supabase, accountId, platform });
  if (!connection) {
    issues.push({
      code: "connection_missing",
      message: `Connect ${PROVIDER_LABELS[platform]} before scheduling this post.`,
    });
  } else {
    if (connection.status === "needs_action") {
      issues.push({
        code: "connection_needs_action",
        message: `${PROVIDER_LABELS[platform]} needs attention before scheduling.`,
      });
    }

    if (!connection.access_token) {
      issues.push({
        code: "connection_token_missing",
        message: `${PROVIDER_LABELS[platform]} access token is missing. Reconnect to continue.`,
      });
    } else if (connection.expires_at) {
      const expiry = new Date(connection.expires_at);
      if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
        issues.push({
          code: "connection_token_expired",
          message: `${PROVIDER_LABELS[platform]} access token has expired. Reconnect to continue.`,
        });
      }
    }

    const metadata = evaluateConnectionMetadata(platform, connection.metadata);
    if (!metadata.complete) {
      issues.push({
        code: "connection_metadata_missing",
        message: `Missing ${METADATA_LABELS[platform]}. Update it in Connections.`,
      });
    }
  }

  if (placement === "story" && platform === "gbp") {
    issues.push({
      code: "placement_invalid",
      message: "Stories are only supported on Facebook and Instagram.",
    });
  }

  const variantData = await loadVariantData({ supabase, contentId });
  const mediaIds = variantData.mediaIds;
  const body = variantData.body;

  if (placement === "feed" && !body.trim().length) {
    issues.push({
      code: "body_missing",
      message: "Add post copy before scheduling.",
    });
  }

  if (!mediaIds.length) {
    issues.push({
      code: "media_missing",
      message:
        placement === "story"
          ? "Stories require one processed image. Add a story image before scheduling."
          : "Attach at least one media asset before scheduling.",
    });
    return issues;
  }

  if (placement === "story" && mediaIds.length !== 1) {
    issues.push({
      code: "media_story_count",
      message: "Stories can only include one image.",
    });
  }

  const mediaAssets = await loadMediaAssets({ supabase, mediaIds });
  if (mediaAssets.length !== mediaIds.length) {
    issues.push({
      code: "media_missing_assets",
      message: "One or more media assets are missing. Reattach media before scheduling.",
    });
    return issues;
  }

  if (placement === "story") {
    const asset = mediaAssets[0];
    if (asset?.media_type !== "image") {
      issues.push({
        code: "media_story_type",
        message: "Stories only support images.",
      });
    }

    const storyVariant = resolveDerivedVariant(asset?.derived_variants, "story");
    if (!storyVariant) {
      issues.push({
        code: "media_story_derivative_missing",
        message: "Story image is still processing. Wait for derivatives or choose another image.",
      });
    }
  }

  return issues;
}

export async function assertPublishReadiness(params: PublishReadinessParams) {
  const issues = await getPublishReadinessIssues(params);
  if (!issues.length) return;
  const message = issues.map((issue) => issue.message).join(" ");
  throw new Error(message);
}

interface ConnectionRow {
  status: "active" | "expiring" | "needs_action" | null;
  access_token: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
}

async function loadConnection({
  supabase,
  accountId,
  platform,
}: {
  supabase: SupabaseClient;
  accountId: string;
  platform: Provider;
}): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .from("social_connections")
    .select("status, access_token, expires_at, metadata")
    .eq("account_id", accountId)
    .eq("provider", platform)
    .maybeSingle<ConnectionRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function loadVariantData({
  supabase,
  contentId,
}: {
  supabase: SupabaseClient;
  contentId: string;
}): Promise<{ mediaIds: string[]; body: string }> {
  const { data, error } = await supabase
    .from("content_variants")
    .select("media_ids, body")
    .eq("content_item_id", contentId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ media_ids: string[] | null; body: string | null }>();

  if (error) {
    throw error;
  }

  return {
    mediaIds: data?.media_ids ?? [],
    body: data?.body ?? "",
  };
}

interface MediaAssetRow {
  id: string;
  media_type: "image" | "video";
  processed_status: string | null;
  derived_variants: Record<string, unknown> | null;
}

async function loadMediaAssets({
  supabase,
  mediaIds,
}: {
  supabase: SupabaseClient;
  mediaIds: string[];
}): Promise<MediaAssetRow[]> {
  const { data, error } = await supabase
    .from("media_assets")
    .select("id, media_type, processed_status, derived_variants")
    .in("id", mediaIds)
    .returns<MediaAssetRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

function resolveDerivedVariant(variants: Record<string, unknown> | null | undefined, key: string) {
  if (!variants || typeof variants !== "object") {
    return null;
  }
  const value = variants[key];
  return typeof value === "string" && value.length ? value : null;
}

```

### Library upload + derivative handling (snippet)
`src/app/(app)/library/actions.ts`
```ts
"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAuthContext } from "@/lib/auth/server";
import { MEDIA_BUCKET } from "@/lib/constants";
import { normaliseTag, normaliseTags } from "@/lib/library/tags";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { MediaAssetSummary } from "@/lib/library/data";
import { resolvePreviewCandidates, normaliseStoragePath, type PreviewCandidate } from "@/lib/library/data";

const REVALIDATE_PATHS = ["/library", "/create", "/planner"] as const;

interface RequestUploadInput {
  fileName: string;
  mimeType: string;
  size: number;
}

type MediaType = "image" | "video";

type DerivativeKey = "story" | "square" | "landscape";

interface SignedUpload {
  uploadUrl: string;
  storagePath: string;
  contentType: string;
}

interface RequestUploadResult {
  assetId: string;
  uploadUrl: string;
  storagePath: string;
  derivativeUploadUrls?: Partial<Record<DerivativeKey, SignedUpload>>;
  mediaType: MediaType;
}

export async function requestMediaUpload(input: RequestUploadInput) {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  await ensureBucketExists(supabase);

  const assetId = crypto.randomUUID();
  const safeFileName = sanitiseFileName(input.fileName, assetId);
  const storagePath = `${accountId}/${assetId}/${safeFileName}`;

  const mediaType = deriveMediaType(input.mimeType);

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Failed to create upload URL");
  }

  let derivativeUploadUrls: RequestUploadResult["derivativeUploadUrls"] = undefined;

  if (mediaType === "image") {
    const variants: Record<DerivativeKey, string> = {
      square: `derived/${assetId}/square.jpg`,
      story: `derived/${assetId}/story.jpg`,
      landscape: `derived/${assetId}/landscape.jpg`,
    };

    const uploads: Partial<Record<DerivativeKey, SignedUpload>> = {};
    await Promise.all(
      (Object.entries(variants) as Array<[DerivativeKey, string]>).map(async ([key, path]) => {
        const { data: variantData, error: variantError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUploadUrl(path, { upsert: true });

        if (variantError || !variantData?.signedUrl) {
          console.error("[library] failed to create signed upload url for derivative", {
            assetId,
            variant: key,
            error: variantError,
          });
          return;
        }

        uploads[key] = {
          uploadUrl: variantData.signedUrl,
          storagePath: path,
          contentType: "image/jpeg",
        };
      }),
    );

    if (Object.keys(uploads).length) {
      derivativeUploadUrls = uploads;
    }
  }

  return {
    assetId,
    uploadUrl: data.signedUrl,
    storagePath,
    derivativeUploadUrls,
    mediaType,
  } satisfies RequestUploadResult;
}

interface FinaliseUploadInput {
  assetId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  derivedVariants?: Record<string, string>;
}

export async function finaliseMediaUpload(input: FinaliseUploadInput) {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  if (!input.storagePath.startsWith(`${accountId}/`)) {
    throw new Error("Storage path does not belong to the authenticated account");
  }

  const mediaType = deriveMediaType(input.mimeType);
  const nowIso = new Date().toISOString();

  const derivedVariants = normaliseDerivedVariants({
    storagePath: input.storagePath,
    derived: input.derivedVariants ?? {},
  });

  const hasImageDerivatives =
    mediaType === "image" && typeof derivedVariants.story === "string" && derivedVariants.story.length > 0;

  const processedStatus: MediaAssetSummary["processedStatus"] =
    mediaType === "image" ? (hasImageDerivatives ? "ready" : "failed") : "ready";

  await supabase
    .from("media_assets")
    .upsert(
      {
        id: input.assetId,
        account_id: accountId,
        storage_path: input.storagePath,
        file_name: input.fileName,
        media_type: mediaType,
        mime_type: input.mimeType,
        size_bytes: input.size,
        processed_status: processedStatus,
        processed_at: processedStatus === "ready" ? nowIso : null,
        derived_variants: derivedVariants,
      },
      { onConflict: "id" },
    )
    .throwOnError();

  const { data: assetRow } = await supabase
    .from("media_assets")
    .select(
      "id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants",
    )
    .eq("id", input.assetId)
    .eq("account_id", accountId)
    .maybeSingle();

  revalidatePath("/library");
  revalidatePath("/create");

  if (!assetRow) {
    return null;
  }

  const { url: previewUrl, shape: previewShape } = await signPreviewFromCandidates(
    supabase,
    resolvePreviewCandidates({
      storagePath: assetRow.storage_path,
      derivedVariants: assetRow.derived_variants ?? {},
    }),
  );

  return mapToSummary(assetRow, previewUrl, previewShape);
}

function normaliseDerivedVariants({
  storagePath,
  derived,
}: {
  storagePath: string;
  derived: Record<string, string>;
}) {
  const result: Record<string, string> = {
    original: storagePath,
  };

  for (const [key, value] of Object.entries(derived)) {
    if (typeof value === "string" && value.length) {
      result[key] = value;
    }
  }
```

### media-derivatives Edge Function
`supabase/functions/media-derivatives/index.ts`
```ts
/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createFFmpeg, fetchFile } from "https://esm.sh/@ffmpeg/ffmpeg@0.12.6";

interface Payload {
  assetId: string;
}

interface MediaAssetRow {
  id: string;
  account_id: string;
  file_name: string;
  storage_path: string;
  media_type: "image" | "video";
  processed_status: "pending" | "processing" | "ready" | "failed" | "skipped";
}

const supabaseUrl = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const mediaBucket = Deno.env.get("MEDIA_BUCKET") ?? "media";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase credentials missing for media derivatives function");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const ffmpeg = createFFmpeg({ log: false });
let ffmpegLoaded = false;

async function ensureFfmpeg() {
  if (!ffmpegLoaded) {
    await ffmpeg.load();
    ffmpegLoaded = true;
  }
}

async function insertNotification(
  accountId: string,
  category: string,
  message: string,
  metadata?: Record<string, unknown>,
) {
  try {
    const { error } = await supabase
      .from("notifications")
      .insert({
        account_id: accountId,
        category,
        message,
        metadata: metadata ?? null,
      });
    if (error) {
      console.error("[media-derivatives] failed to insert notification", error);
    }
  } catch (error) {
    console.error("[media-derivatives] unexpected notification error", error);
  }
}

function normaliseError(error: unknown) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}


Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Payload | null = null;
  try {
    body = await request.json();
  } catch (error) {
    console.error("[media-derivatives] invalid payload", error);
    return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body?.assetId) {
    return Response.json({ ok: false, error: "assetId missing" }, { status: 400 });
  }

  try {
    return await processAsset(body.assetId);
  } catch (error) {
    console.error("[media-derivatives] unexpected failure", error);
    return Response.json({ ok: false, error: "Unhandled error" }, { status: 500 });
  }
});

async function processAsset(assetId: string) {
  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("id, account_id, file_name, storage_path, media_type, processed_status")
    .eq("id", assetId)
    .maybeSingle<MediaAssetRow>();

  if (error || !asset) {
    console.error("[media-derivatives] asset fetch failed", error);
    return Response.json({ ok: false, error: "Asset not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("media_assets")
    .update({ processed_status: "processing", processed_at: nowIso })
    .eq("id", assetId);

  if (asset.media_type !== "image") {
    await supabase
      .from("media_assets")
      .update({
        processed_status: "skipped",
        processed_at: nowIso,
        derived_variants: {},
      })
      .eq("id", assetId);

    await insertNotification(asset.account_id, "media_derivative_skipped", `${asset.file_name} derivatives skipped`, {
      assetId,
      mediaType: asset.media_type,
      reason: "unsupported_media_type",
    });

    return Response.json({ ok: true, skipped: true, reason: "unsupported_media_type" });
  }

  try {
    const { data: signed, error: signedError } = await supabase.storage
      .from(mediaBucket)
      .createSignedUrl(asset.storage_path, 300);

    if (signedError || !signed?.signedUrl) {
      throw new Error("Unable to create signed URL for asset");
    }

    const originalBuffer = await fetchFile(signed.signedUrl);

    await ensureFfmpeg();
    const inputName = "input";
    ffmpeg.FS("writeFile", inputName, originalBuffer);

    const variants: Array<{ name: string; args: string[]; output: string }> = [
      {
        name: "square",
        args: ["-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350", "square.jpg"],
        output: "square.jpg",
      },
      {
        name: "story",
        args: ["-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "story.jpg"],
        output: "story.jpg",
      },
      {
        name: "landscape",
        args: ["-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080", "landscape.jpg"],
        output: "landscape.jpg",
      },
    ];

    const derivedPaths: Record<string, string> = {};

    for (const variant of variants) {
      const outputName = variant.output;
      await ffmpeg.run("-i", inputName, ...variant.args);
      const data = ffmpeg.FS("readFile", outputName);
      const storagePath = `derived/${asset.id}/${outputName}`;
      const { error: uploadError } = await supabase.storage
        .from(mediaBucket)
        .upload(storagePath, data.buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (uploadError) {
        throw uploadError;
      }
      derivedPaths[variant.name] = storagePath;
      ffmpeg.FS("unlink", outputName);
    }

    ffmpeg.FS("unlink", inputName);

    if (!derivedPaths.story) {
      throw new Error('story derivative missing after ffmpeg processing');
    }

    await supabase
      .from("media_assets")
      .update({
        processed_status: "ready",
        processed_at: new Date().toISOString(),
        derived_variants: derivedPaths,
      })
      .eq("id", assetId);

    return Response.json({ ok: true, derived: derivedPaths });
  } catch (error) {
    const errorMessage = normaliseError(error);
    console.error("[media-derivatives] processing failed", error);
    await supabase
      .from("media_assets")
      .update({
        processed_status: "failed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", assetId);

    await insertNotification(asset.account_id, "media_derivative_failed", `${asset.file_name} derivatives failed`, {
      assetId,
      error: errorMessage,
    });

    return Response.json({ ok: false, error: "Processing failed" }, { status: 500 });
  }
}

```

### OAuth scopes and redirect builder
`src/lib/connections/oauth.ts`
```ts
import { env } from "@/env";
import { getMetaOAuthBase } from "@/lib/meta/graph";

const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "business_management",
].join(",");

const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"].join(" ");

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

export type Provider = "facebook" | "instagram" | "gbp";

export function buildOAuthRedirectUrl(provider: Provider, state: string) {
  switch (provider) {
    case "facebook":
      return buildFacebookOAuthUrl(state);
    case "instagram":
      return buildInstagramOAuthUrl(state);
    case "gbp":
      return buildGoogleOAuthUrl(state);
    default:
      throw new Error(`Unsupported provider ${provider}`);
  }
}

function buildFacebookOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/facebook/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_SCOPES,
    response_type: "code",
  });
  return `${getMetaOAuthBase()}/dialog/oauth?${params.toString()}`;
}

function buildInstagramOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/instagram/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: INSTAGRAM_SCOPES,
    response_type: "code",
  });
  return `${getMetaOAuthBase()}/dialog/oauth?${params.toString()}`;
}

function buildGoogleOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/gbp/callback`;
  const params = new URLSearchParams({
    client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    scope: GBP_SCOPES,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

```

### Provider token exchange + metadata resolution
`src/lib/connections/token-exchange.ts`
```ts
import { env } from "@/env";
import { getMetaGraphApiBase } from "@/lib/meta/graph";
import type { Provider } from "@/lib/connections/oauth";

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
const GRAPH_BASE = getMetaGraphApiBase();

interface ExchangeOptions {
  existingMetadata?: Record<string, unknown> | null;
  existingDisplayName?: string | null;
}

const GOOGLE_LOCATION_CACHE_TTL_MS = 5 * 60 * 1000;
const googleLocationCache = new Map<string, { metadata: { locationId: string }; displayName: string | null; expiresAt: number }>();

interface FacebookPage {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
    name?: string;
  } | null;
}

interface GoogleLocation {
  name?: string;
  title?: string;
}

export interface ProviderTokenExchange {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  displayName?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function exchangeProviderAuthCode(
  provider: Provider,
  authCode: string,
  options: ExchangeOptions = {},
): Promise<ProviderTokenExchange> {
  switch (provider) {
    case "facebook":
    case "instagram":
      return exchangeFacebookFamilyCode(provider, authCode, options.existingMetadata ?? null);
    case "gbp":
      return exchangeGoogleCode(authCode, options.existingMetadata ?? null, options.existingDisplayName ?? null);
    default:
      throw new Error(`Unsupported provider ${provider}`);
  }
}

async function exchangeFacebookFamilyCode(
  provider: "facebook" | "instagram",
  code: string,
  existingMetadata: Record<string, unknown> | null,
): Promise<ProviderTokenExchange> {
  const redirectUri = `${SITE_URL}/api/oauth/${provider}/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    client_secret: env.server.FACEBOOK_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });

  const shortLivedResponse = await fetch(
    `${GRAPH_BASE}/oauth/access_token?${params.toString()}`,
  );
  const shortJson = await safeJson(shortLivedResponse);

  if (!shortLivedResponse.ok) {
    throw new Error(resolveGraphError(shortJson));
  }

  const shortToken = typeof shortJson?.access_token === "string" ? shortJson.access_token : null;
  const shortExpiresIn = normaliseExpires(shortJson?.expires_in);

  if (!shortToken) {
    throw new Error("Facebook token exchange failed: missing access token");
  }

  let userAccessToken = shortToken;
  let expiresIn = shortExpiresIn;

  try {
    const longLived = await exchangeLongLivedFacebookToken(shortToken);
    userAccessToken = longLived.accessToken;
    if (longLived.expiresIn) {
      expiresIn = longLived.expiresIn;
    }
  } catch (error) {
    console.warn("[connections] failed to obtain long-lived Facebook token", error);
  }

  const expiresAt = expiresIn ? toIsoExpiry(expiresIn) : null;
  const pages = await fetchManagedPages(userAccessToken);

  if (!pages.length) {
    throw new Error("No Facebook Pages found for the connected account.");
  }

  const metadata: Record<string, unknown> = {};

  if (provider === "facebook") {
    const desiredPageId = getString(existingMetadata?.pageId);
    const page = selectFacebookPage(pages, desiredPageId);
    if (!page) {
      throw new Error(
        desiredPageId
          ? `Could not find Facebook Page ${desiredPageId}. Check that the account still has access to it.`
          : "No Facebook Page with publishing access was returned.",
      );
    }

    const accessToken = getString(page.access_token);
    if (!accessToken) {
      throw new Error("Selected Facebook Page is missing an access token. Try reconnecting and granting publish permissions.");
    }

    if (getString(page.id)) {
      metadata.pageId = page.id;
    }

    if (page.instagram_business_account?.id) {
      metadata.igBusinessId = page.instagram_business_account.id;
    }

    const displayName = getString(page.name);

    return {
      accessToken,
      refreshToken: null,
      expiresAt,
      displayName: displayName ?? null,
      metadata: Object.keys(metadata).length ? metadata : null,
    };
  }

  const desiredIgId = getString(existingMetadata?.igBusinessId);
  const instagramSelection = selectInstagramAccount(pages, desiredIgId);

  if (!instagramSelection) {
    throw new Error(
      desiredIgId
        ? `Could not find Instagram Business Account ${desiredIgId}. Ensure it is linked to the selected Facebook Page.`
        : "No Instagram Business Account was linked to the Facebook Pages returned by Facebook."
    );
  }

  const pageToken = getString(instagramSelection.page.access_token);
  if (!pageToken) {
    throw new Error("Instagram publishing requires a Page access token. Grant the 'pages_manage_posts' permission and reconnect.");
  }

  if (getString(instagramSelection.page.id)) {
    metadata.pageId = instagramSelection.page.id;
  }

  metadata.igBusinessId = instagramSelection.instagram.id;

  if (getString(instagramSelection.instagram.username)) {
    metadata.instagramUsername = instagramSelection.instagram.username;
  }

  const displayName =
    getString(instagramSelection.instagram.username) ??
    getString(instagramSelection.instagram.name) ??
    getString(instagramSelection.page.name);

  return {
    accessToken: pageToken,
    refreshToken: null,
    expiresAt,
    displayName: displayName ?? null,
    metadata,
  };
}

async function exchangeGoogleCode(
  code: string,
  existingMetadata: Record<string, unknown> | null,
  existingDisplayName: string | null,
): Promise<ProviderTokenExchange> {
  const redirectUri = `${SITE_URL}/api/oauth/gbp/callback`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
      client_secret: env.server.GOOGLE_MY_BUSINESS_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  });

  const json = await safeJson(response);
  if (!response.ok) {
    throw new Error(resolveGoogleError(json));
  }

  const accessToken = getString(json?.access_token);
  if (!accessToken) {
    throw new Error("Google token exchange failed: missing access token");
  }

  const refreshToken = getString(json?.refresh_token);
  const expiresIn = normaliseExpires(json?.expires_in);
  const expiresAt = expiresIn ? toIsoExpiry(expiresIn) : null;

  const resolvedLocation = await resolveGoogleLocation(accessToken, existingMetadata, existingDisplayName);

  return {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt,
    displayName: resolvedLocation?.displayName ?? null,
    metadata: resolvedLocation?.metadata ?? null,
  };
}

async function exchangeLongLivedFacebookToken(shortToken: string) {
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    client_secret: env.server.FACEBOOK_APP_SECRET,
    fb_exchange_token: shortToken,
  });

  const response = await fetch(
    `${GRAPH_BASE}/oauth/access_token?${longParams.toString()}`,
  );
  const json = await safeJson(response);

  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const accessToken = getString(json?.access_token);
  if (!accessToken) {
    throw new Error("Long-lived token exchange failed");
  }

  return {
    accessToken,
    expiresIn: normaliseExpires(json?.expires_in),
  };
}

async function fetchManagedPages(userAccessToken: string) {
  const params = new URLSearchParams({
    access_token: userAccessToken,
    fields: "id,name,access_token,instagram_business_account{id,username,name}",
  });

  const response = await fetch(
    `${GRAPH_BASE}/me/accounts?${params.toString()}`,
  );
  const json = await safeJson(response);

  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const data = Array.isArray(json?.data) ? (json.data as FacebookPage[]) : [];
  return data.filter((page) => page && typeof page === "object");
}

function selectFacebookPage(pages: FacebookPage[], desiredPageId: string | null) {
  if (desiredPageId) {
    const matched = pages.find((page) => getString(page.id) === desiredPageId);
    if (matched) {
      return matched;
    }
  }
  return pages[0] ?? null;
}

function selectInstagramAccount(pages: FacebookPage[], desiredInstagramId: string | null) {
  const pagesWithInstagram = pages
    .map((page) => ({
      page,
      instagram: page.instagram_business_account,
    }))
    .filter((entry) => entry.instagram && getString(entry.instagram?.id));

  if (desiredInstagramId) {
    const match = pagesWithInstagram.find(
      (entry) => getString(entry.instagram?.id) === desiredInstagramId,
    );
    if (match) {
      return {
        page: match.page,
        instagram: {
          id: getString(match.instagram?.id)!,
          username: getString(match.instagram?.username) ?? undefined,
          name: getString(match.instagram?.name) ?? undefined,
        },
      };
    }
  }

  const first = pagesWithInstagram[0];
  if (!first) {
    return null;
  }

  return {
    page: first.page,
    instagram: {
      id: getString(first.instagram?.id)!,
      username: getString(first.instagram?.username) ?? undefined,
      name: getString(first.instagram?.name) ?? undefined,
    },
  };
}

async function resolveGoogleLocation(accessToken: string, existingMetadata: Record<string, unknown> | null, existingDisplayName: string | null) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  } as const;

  const desiredLocationId = getString(existingMetadata?.locationId);
  const fallbackDisplayName = existingDisplayName ?? null;

  if (desiredLocationId) {
    const cached = googleLocationCache.get(desiredLocationId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    const locationResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${desiredLocationId}?readMask=name,title`,
      { headers },
    );
    const locationJson = await safeJson(locationResponse);
    if (locationResponse.ok) {
      const result = {
        metadata: { locationId: desiredLocationId },
        displayName: getString(locationJson?.title) ?? null,
      } as const;
      googleLocationCache.set(desiredLocationId, { ...result, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
      return result;
    }
    const locationError = resolveGoogleError(locationJson);
    if (locationResponse.status === 429 || /quota/i.test(locationError)) {
      if (desiredLocationId) {
        const fallback = {
          metadata: { locationId: desiredLocationId },
          displayName: fallbackDisplayName,
        } as const;
        googleLocationCache.set(desiredLocationId, { ...fallback, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
        return fallback;
      }
      throw new Error(locationError || "Google Business Profile quota exceeded. Please retry later.");
    }
    console.warn("[connections] failed to fetch existing GBP location", locationError);
  }

  const accountsResponse = await fetch(
    "https://mybusinessbusinessinformation.googleapis.com/v1/accounts",
    { headers },
  );
  const accountsJson = await safeJson(accountsResponse);

  if (!accountsResponse.ok) {
    const accountsError = resolveGoogleError(accountsJson);
    if (accountsResponse.status === 429 || /quota/i.test(accountsError)) {
      if (desiredLocationId) {
        const fallback = {
          metadata: { locationId: desiredLocationId },
          displayName: fallbackDisplayName,
        } as const;
        googleLocationCache.set(desiredLocationId, { ...fallback, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
        return fallback;
      }
      throw new Error(accountsError || "Google Business Profile quota exceeded. Please retry later.");
    }
    throw new Error(accountsError);
  }

  const accounts = Array.isArray(accountsJson?.accounts) ? accountsJson.accounts : [];

  for (const account of accounts) {
    const accountName = getString(account?.name);
    if (!accountName) {
      continue;
    }

    const locationsResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100&readMask=name,title`,
      { headers },
    );
    const locationsJson = await safeJson(locationsResponse);

    if (!locationsResponse.ok) {
      const locationsError = resolveGoogleError(locationsJson);
      if (locationsResponse.status === 429 || /quota/i.test(locationsError)) {
        if (desiredLocationId) {
          const fallback = {
            metadata: { locationId: desiredLocationId },
            displayName: fallbackDisplayName,
          } as const;
          googleLocationCache.set(desiredLocationId, { ...fallback, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
          return fallback;
        }
        throw new Error(locationsError || "Google Business Profile quota exceeded. Please retry later.");
      }
      console.warn(
        "[connections] failed to list GBP locations",
        locationsError,
      );
      continue;
    }

    const locations = Array.isArray(locationsJson?.locations)
      ? (locationsJson.locations as GoogleLocation[])
      : [];

    if (!locations.length) {
      continue;
    }

    const matched = desiredLocationId
      ? locations.find((loc) => getString(loc.name) === desiredLocationId)
      : locations[0];

    const location = matched ?? locations[0];
    if (!location) {
      continue;
    }

    const locationId = getString(location.name);
    if (!locationId) {
      continue;
    }

    const result = {
      metadata: { locationId },
      displayName: getString(location.title) ?? null,
    } as const;
    googleLocationCache.set(locationId, { ...result, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });

    return result;
  }

  throw new Error(
    "No Google Business Profile locations were found. Ensure the connected account has at least one verified location.",
  );
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveGraphError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } }).error;
    const message = err?.message ?? "Unknown Graph API error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Facebook token exchange failed";
}

function resolveGoogleError(payload: unknown) {
  if (payload && typeof payload === "object") {
    if (
      "error_description" in payload &&
      typeof (payload as { error_description: unknown }).error_description === "string"
    ) {
      return (payload as { error_description: string }).error_description;
    }
    if ("error" in payload && typeof (payload as { error: unknown }).error === "string") {
      return (payload as { error: string }).error;
    }
    if ("error" in payload && typeof (payload as { error: unknown }).error === "object") {
      const err = (payload as { error: { message?: unknown; status?: unknown; code?: unknown } }).error;
      if (err && typeof err === "object") {
        const message = typeof err.message === "string" ? err.message : undefined;
        const status = typeof err.status === "string" ? err.status : undefined;
        if (message) {
          return status ? `${status}: ${message}` : message;
        }
      }
    }
  }
  return "Google token exchange failed";
}

function getString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function normaliseExpires(input: unknown): number | null {
  const expiresIn = Number(input ?? 0);
  return Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null;
}

function toIsoExpiry(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

```

### Ops - diagnose publishing
`scripts/ops/diagnose-publishing.ts`
```ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
});

async function main() {
    console.log("Diagnosing publishing issues...");

    // 1. Check for stuck in_progress jobs
    console.log("\nChecking for stuck in_progress jobs...");
    const { data: stuckJobs, error: stuckError } = await supabase
        .from("publish_jobs")
        .select("*")
        .eq("status", "in_progress");

    if (stuckError) console.error("Error fetching stuck jobs:", stuckError);

    if (stuckJobs?.length) {
        console.log(`Found ${stuckJobs.length} stuck jobs:`);
        stuckJobs.forEach((job) => {
            console.log(`- Job ${job.id}: Last updated ${job.updated_at}, Content: ${job.content_item_id}`);
        });
    } else {
        console.log("No stuck jobs found.");
    }

    // 2. Check for due jobs in queue
    console.log("\nChecking for due queued jobs...");

    // Check jobs due more than 5 minutes ago
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: dueJobs, error: dueError } = await supabase
        .from("publish_jobs")
        .select("*")
        .eq("status", "queued")
        .lte("next_attempt_at", fiveMinsAgo);

    if (dueError) console.error("Error fetching due jobs:", dueError);

    if (dueJobs?.length) {
        console.log(`Found ${dueJobs.length} overdue queued jobs (due > 5 mins ago):`);
        dueJobs.forEach((job) => {
            console.log(`- Job ${job.id}: Due ${job.next_attempt_at}, Content: ${job.content_item_id}`);
        });
    } else {
        console.log("No overdue queued jobs found.");
    }

    // 3. Check for orphaned content (scheduled but no job)
    console.log("\nChecking for orphaned scheduled content...");
    const { data: scheduledContent, error: contentError } = await supabase
        .from("content_items")
        .select("id, status, scheduled_for, updated_at")
        .eq("status", "scheduled");

    if (contentError) console.error("Error fetching scheduled content:", contentError);

    if (scheduledContent?.length) {
        // Get all job content IDs
        const { data: allJobs } = await supabase
            .from("publish_jobs")
            .select("content_item_id");

        const jobContentIds = new Set(allJobs?.map((j) => j.content_item_id) ?? []);

        const orphaned = scheduledContent.filter((c) => !jobContentIds.has(c.id));
        if (orphaned.length) {
            console.log(`Found ${orphaned.length} orphaned scheduled items (no publish_job):`);
            orphaned.forEach((c) => {
                console.log(`- Content ${c.id}: Scheduled ${c.scheduled_for}`);
            });
        } else {
            console.log(`Found ${scheduledContent.length} scheduled items, all have jobs.`);
        }
    } else {
        console.log("No scheduled content found.");
    }
}

main().catch((err) => console.error(err));

```

### Ops - invoke Edge Function
`scripts/ops/invoke-function.ts`
```ts
#!/usr/bin/env tsx
export { };
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const [, , functionName, payloadArg] = process.argv;

if (!functionName) {
  console.error("Usage: npm run ops:invoke -- <function-name> [jsonPayload]");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const baseUrl = supabaseUrl.replace("https://", "");
const functionDomain = baseUrl.replace(".supabase.co", ".functions.supabase.co");
const functionUrl = `https://${functionDomain}/${functionName}`;

let body = "{}";
if (payloadArg) {
  try {
    JSON.parse(payloadArg);
    body = payloadArg;
  } catch (error) {
    console.error("Payload must be valid JSON.");
    console.error(error);
    process.exit(1);
  }
}

async function main() {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      "X-Client-Info": "cheersai-ops-script",
    },
    body,
  });

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown;
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (error) {
      console.warn("Failed to parse JSON response", error);
      payload = await response.text();
    }
  } else {
    payload = await response.text();
  }

  if (!response.ok) {
    console.error(`Function ${functionName} responded with ${response.status}`);
    console.error(payload);
    process.exit(1);
  }

  console.log(`[OK] ${functionName} invoked successfully (${response.status})`);
  if (payload) {
    console.dir(payload, { depth: 4 });
  }
}

main().catch((error) => {
  console.error(`Unhandled error invoking ${functionName}`, error);
  process.exit(1);
});

```

### Ops - regenerate story derivatives
`scripts/ops/regenerate-story-derivatives.ts`
```ts
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envFiles = ['.env', '.env.local'];
for (const file of envFiles) {
  const fullPath = resolve(process.cwd(), file);
  if (existsSync(fullPath)) {
    loadEnv({ path: fullPath, override: false });
  }
}
const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase credentials. Provide NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}
const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
async function main() {
  const { data: assets, error } = await supabase
    .from('media_assets')
    .select('id, media_type, derived_variants, processed_status')
    .eq('media_type', 'image')
    .filter('derived_variants->>story', 'is', 'null');
  if (error) {
    throw error;
  }
  if (!assets?.length) {
    console.info('No media assets require story derivative regeneration.');
    return;
  }
  console.info(`Regenerating story derivatives for ${assets.length} asset(s).`);
  for (const asset of assets) {
    try {
      const response = await supabase.functions.invoke('media-derivatives', {
        body: { assetId: asset.id },
      });
      if (response.error) {
        console.error(`[derivatives] invoke failed for ${asset.id}`, response.error);
      } else {
        console.info(`[derivatives] invoked for ${asset.id}`);
      }
    } catch (invokeError) {
      console.error(`[derivatives] unexpected error for ${asset.id}`, invokeError);
    }
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

```

### Ops - backfill connection metadata
`scripts/ops/backfill-connections.ts`
```ts
#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";

type Provider = "facebook" | "instagram" | "gbp";

type ConnectionStatus = "active" | "expiring" | "needs_action";

type ConnectionRow = {
  id: string;
  account_id: string;
  provider: Provider;
  metadata: Record<string, unknown> | null;
  status: ConnectionStatus;
  access_token: string | null;
  display_name: string | null;
};

type BackfillResult = {
  metadata: Record<string, unknown>;
  displayName?: string | null;
};

const REQUIRED_METADATA: Record<Provider, string> = {
  facebook: "pageId",
  instagram: "igBusinessId",
  gbp: "locationId",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Supabase credentials missing - set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const metaGraphVersion =
  process.env.META_GRAPH_VERSION ??
  process.env.NEXT_PUBLIC_META_GRAPH_VERSION ??
  "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${metaGraphVersion}`;

async function main() {
  const { data, error } = await supabase
    .from("social_connections")
    .select("id, account_id, provider, metadata, status, access_token, display_name");

  if (error) {
    console.error("Failed to load social connections", error);
    process.exit(1);
  }

  const connections = (data ?? []) as ConnectionRow[];
  if (!connections.length) {
    console.log("No connections found - nothing to backfill.");
    return;
  }

  const summary = {
    updated: 0,
    alreadyComplete: 0,
    failed: 0,
  };
  const failures: string[] = [];

  for (const connection of connections) {
    const requiredKey = REQUIRED_METADATA[connection.provider];
    const existingMetadata = (connection.metadata ?? {}) as Record<string, unknown>;
    const hasKey = typeof existingMetadata[requiredKey] === "string" &&
      (existingMetadata[requiredKey] as string).length > 0;

    if (hasKey) {
      summary.alreadyComplete += 1;
      continue;
    }

    if (!connection.access_token) {
      summary.failed += 1;
      const message = `${connection.provider} connection ${connection.id} has no access token.`;
      failures.push(message);
      console.error(`[ERROR] ${message}`);
      continue;
    }

    try {
      const result = await resolveMetadata(connection, existingMetadata);
      if (!result) {
        summary.alreadyComplete += 1;
        continue;
      }

      const mergedMetadata = { ...existingMetadata, ...result.metadata };
      const updatePayload: Record<string, unknown> = {
        metadata: mergedMetadata,
        updated_at: new Date().toISOString(),
      };

      if (connection.status === "needs_action" && typeof mergedMetadata[requiredKey] === "string") {
        updatePayload.status = "active";
      }

      if (result.displayName && !connection.display_name) {
        updatePayload.display_name = result.displayName;
      }

      const { error: updateError } = await supabase
        .from("social_connections")
        .update(updatePayload)
        .eq("id", connection.id);

      if (updateError) {
        throw updateError;
      }

      summary.updated += 1;
      console.log(`[OK] ${connection.provider} connection ${connection.id} updated.`);
    } catch (error) {
      summary.failed += 1;
      const message = normaliseError(error);
      failures.push(`${connection.provider} connection ${connection.id}: ${message}`);
      console.error(`[ERROR] Failed to backfill ${connection.provider} connection ${connection.id}: ${message}`);
    }
  }

  console.log("\nBackfill summary:");
  console.log(`  * Updated: ${summary.updated}`);
  console.log(`  * Already complete: ${summary.alreadyComplete}`);
  console.log(`  * Failed: ${summary.failed}`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
  }
}

async function resolveMetadata(
  connection: ConnectionRow,
  existingMetadata: Record<string, unknown>,
): Promise<BackfillResult | null> {
  switch (connection.provider) {
    case "facebook":
      return backfillFacebook(connection.access_token!);
    case "instagram":
      return backfillInstagram(connection.access_token!);
    case "gbp":
      return backfillGoogle(existingMetadata, connection.access_token!);
    default:
      return null;
  }
}

async function backfillFacebook(accessToken: string): Promise<BackfillResult> {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const json = await safeJson(response);
  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const pageId = getString(json?.id);
  if (!pageId) {
    throw new Error("Facebook API did not return a Page id");
  }

  const displayName = getString(json?.name);
  return {
    metadata: { pageId },
    displayName: displayName ?? null,
  };
}

async function backfillInstagram(accessToken: string): Promise<BackfillResult> {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "id,name,instagram_business_account{id,username,name}");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const json = await safeJson(response);
  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const pageId = getString(json?.id);
  const instagram = json?.instagram_business_account ?? null;
  const instagramId = getString(instagram?.id);

  if (!pageId || !instagramId) {
    throw new Error(
      "Instagram Business Account not linked to the selected Facebook Page. Reconnect via Connections page.",
    );
  }

  const metadata: Record<string, unknown> = {
    pageId,
    igBusinessId: instagramId,
  };

  const username = getString(instagram?.username) ?? getString(instagram?.name) ?? getString(json?.name);
  if (username) {
    metadata.instagramUsername = username;
  }

  return {
    metadata,
    displayName: username ?? null,
  };
}

async function backfillGoogle(
  existingMetadata: Record<string, unknown>,
  accessToken: string,
): Promise<BackfillResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const desiredLocationId = getString(existingMetadata.locationId);

  if (desiredLocationId) {
    const locationResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${desiredLocationId}`,
      { headers },
    );
    const locationJson = await safeJson(locationResponse);
    if (locationResponse.ok) {
      return {
        metadata: { locationId: desiredLocationId },
        displayName: getString(locationJson?.title) ?? null,
      };
    }
    console.warn("[WARN] Failed to hydrate stored locationId - will enumerate locations", resolveGoogleError(locationJson));
  }

  const accountsResponse = await fetch(
    "https://mybusinessbusinessinformation.googleapis.com/v1/accounts",
    { headers },
  );
  const accountsJson = await safeJson(accountsResponse);

  if (!accountsResponse.ok) {
    throw new Error(resolveGoogleError(accountsJson));
  }

  const accounts = Array.isArray(accountsJson?.accounts) ? accountsJson.accounts : [];

  for (const account of accounts) {
    const accountName = getString(account?.name);
    if (!accountName) {
      continue;
    }

    const locationsResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100`,
      { headers },
    );
    const locationsJson = await safeJson(locationsResponse);

    if (!locationsResponse.ok) {
      console.warn("[WARN] Failed to list GBP locations", resolveGoogleError(locationsJson));
      continue;
    }

    const locations = Array.isArray(locationsJson?.locations) ? locationsJson.locations : [];
    if (!locations.length) {
      continue;
    }

    const matched = desiredLocationId
      ? locations.find((loc: unknown) => getString((loc as Record<string, unknown>)?.name) === desiredLocationId)
      : locations[0];

    if (!matched) {
      continue;
    }

    const locationId = getString((matched as Record<string, unknown>)?.name);
    if (!locationId) {
      continue;
    }

    return {
      metadata: { locationId },
      displayName: getString((matched as Record<string, unknown>)?.title) ?? null,
    };
  }

  throw new Error("No Google Business Profile locations were returned for this access token.");
}

function normaliseError(error: unknown) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    console.warn("Failed to parse JSON response", error);
    return null;
  }
}

function getString(value: unknown) {
  return typeof value === "string" && value.length ? value : null;
}

function resolveGraphError(payload: unknown) {
  const error = (payload as { error?: { message?: string; code?: number } })?.error;
  if (error?.message) {
    return error.message;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "Facebook API error";
  }
}

function resolveGoogleError(payload: unknown) {
  const error = (payload as { error?: { message?: string } })?.error;
  if (error?.message) {
    return error.message;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "Google API error";
  }
}

main().catch((error) => {
  console.error("Unexpected failure running backfill", error);
  process.exit(1);
});

```

### Environment variables and production checks
`src/env.ts`
```ts
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

```

### Initial schema (accounts, connections, media, content, publish_jobs, notifications)
`supabase/migrations/20250203120000_initial.sql`
```sql
create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key,
  email text not null unique,
  display_name text,
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_profile (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  tone_formal numeric(3,2) not null default 0.50,
  tone_playful numeric(3,2) not null default 0.50,
  key_phrases text[] default array[]::text[],
  banned_topics text[] default array[]::text[],
  default_hashtags text[] default array[]::text[],
  default_emojis text[] default array[]::text[],
  instagram_signature text,
  facebook_signature text,
  gbp_cta text,
  updated_at timestamptz not null default now()
);

create table if not exists public.posting_defaults (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  facebook_location_id text,
  instagram_location_id text,
  gbp_location_id text,
  notifications jsonb not null default jsonb_build_object(
    'emailFailures', true,
    'emailTokenExpiring', true
  ),
  gbp_cta_standard text not null default 'LEARN_MORE',
  gbp_cta_event text not null default 'LEARN_MORE',
  gbp_cta_offer text not null default 'REDEEM',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','gbp')),
  status text not null check (status in ('active','expiring','needs_action')) default 'needs_action',
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  display_name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_connections_account_idx on public.social_connections (account_id);
create unique index if not exists social_connections_unique_provider on public.social_connections (account_id, provider);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  media_type text not null check (media_type in ('image','video')),
  mime_type text,
  size_bytes bigint,
  tags text[] default array[]::text[],
  uploaded_at timestamptz not null default now()
);
create index if not exists media_assets_account_idx on public.media_assets (account_id);
create index if not exists media_assets_uploaded_idx on public.media_assets (uploaded_at desc);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  campaign_type text not null check (campaign_type in ('event','promotion','weekly','instant','story_series')),
  start_at timestamptz,
  end_at timestamptz,
  hero_media_id uuid references public.media_assets (id),
  auto_confirm boolean not null default false,
  status text not null check (status in ('draft','scheduled','completed','cancelled')) default 'draft',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_account_idx on public.campaigns (account_id);
create index if not exists campaigns_status_idx on public.campaigns (status);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete set null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','gbp')),
  scheduled_for timestamptz,
  status text not null check (status in ('draft','scheduled','publishing','posted','failed')) default 'draft',
  prompt_context jsonb,
  auto_generated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_items_account_idx on public.content_items (account_id);
create index if not exists content_items_schedule_idx on public.content_items (scheduled_for);
create index if not exists content_items_status_idx on public.content_items (status);

create table if not exists public.content_variants (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  body text,
  media_ids uuid[] default array[]::uuid[],
  preview_data jsonb,
  validation jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists content_variants_content_idx on public.content_variants (content_item_id);

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  attempt integer not null default 0,
  status text not null check (status in ('queued','in_progress','succeeded','failed')) default 'queued',
  last_error text,
  provider_response jsonb,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publish_jobs_status_idx on public.publish_jobs (status);
create index if not exists publish_jobs_next_idx on public.publish_jobs (next_attempt_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  category text,
  message text not null,
  read_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notifications_account_idx on public.notifications (account_id);
create index if not exists notifications_read_idx on public.notifications (read_at);
```

### Add connection metadata column
`supabase/migrations/20250204100000_add_connection_metadata.sql`
```sql
alter table public.social_connections
  add column if not exists metadata jsonb default '{}'::jsonb;

create index if not exists social_connections_metadata_idx
  on public.social_connections using gin ((metadata));

```

### Add media processing columns
`supabase/migrations/20250204103000_add_media_processing_columns.sql`
```sql
alter table public.media_assets
  add column if not exists processed_status text not null default 'pending' check (processed_status in ('pending','processing','ready','failed')),
  add column if not exists processed_at timestamptz,
  add column if not exists derived_variants jsonb default '{}'::jsonb;

create index if not exists media_assets_processed_status_idx on public.media_assets (processed_status);

```

### Add story placement
`supabase/migrations/20250218090000_add_story_placement.sql`
```sql
alter table public.content_items
  add column if not exists placement text not null default 'feed'
    check (placement in ('feed','story'));

update public.content_items set placement = 'feed' where placement is null;

alter table public.publish_jobs
  add column if not exists placement text not null default 'feed'
    check (placement in ('feed','story'));

update public.publish_jobs set placement = 'feed' where placement is null;

comment on column public.content_items.placement is 'Placement of the content (feed or story)';
comment on column public.publish_jobs.placement is 'Placement of the publish job (feed or story)';

```

### Add variant_id to publish_jobs + DB context RPC
`supabase/migrations/20250218100000_add_variant_id_to_publish_jobs.sql`
```sql
alter table public.publish_jobs
  add column if not exists variant_id uuid;

update public.publish_jobs pj
set variant_id = sub.id
from (
  select distinct on (cv.content_item_id) cv.content_item_id, cv.id
  from public.content_variants cv
  where cv.content_item_id is not null
  order by cv.content_item_id, cv.updated_at desc, cv.id
) as sub
where pj.variant_id is null
  and sub.content_item_id = pj.content_item_id;

alter table public.publish_jobs
  alter column variant_id set not null;

alter table public.publish_jobs
  add constraint publish_jobs_variant_id_fkey
  foreign key (variant_id) references public.content_variants(id) on delete cascade;

create index if not exists publish_jobs_variant_id_idx on public.publish_jobs (variant_id);

create unique index if not exists publish_jobs_story_unique
  on public.publish_jobs (content_item_id, placement)
  where placement = 'story' and status in ('queued','in_progress');

create or replace view public.publish_jobs_with_variant as
select pj.*, cv.media_ids
from public.publish_jobs pj
join public.content_variants cv on cv.id = pj.variant_id;

create or replace function public.inspect_worker_db_context()
returns table (
  is_replica boolean,
  isolation text,
  txn bigint,
  ts timestamptz
) language sql security definer
as $$
  select
    pg_is_in_recovery() as is_replica,
    current_setting('transaction_isolation') as isolation,
    txid_current() as txn,
    now() as ts;
$$;

```

### RLS for publish_jobs (excerpt)
`supabase/migrations/20250212150000_enable_rls.sql`
```sql
    select 1
    from public.content_items ci
    where ci.id = content_variants.content_item_id
      and ci.account_id = public.current_account_id()
  )
) with check (
  auth.role() = 'service_role' or exists (
    select 1
    from public.content_items ci
    where ci.id = content_variants.content_item_id
      and ci.account_id = public.current_account_id()
  )
);

-- Publish jobs (bridge via content items)
alter table public.publish_jobs enable row level security;
create policy "Publish jobs accessible via content" on public.publish_jobs
for all using (
  auth.role() = 'service_role' or exists (
    select 1
    from public.content_items ci
    where ci.id = publish_jobs.content_item_id
      and ci.account_id = public.current_account_id()
  )
) with check (
  auth.role() = 'service_role' or exists (
    select 1
    from public.content_items ci
    where ci.id = publish_jobs.content_item_id
      and ci.account_id = public.current_account_id()
  )
);

-- Notifications
alter table public.notifications enable row level security;
create policy "Notifications accessible by account" on public.notifications
for all using (
  auth.role() = 'service_role' or account_id = public.current_account_id()
) with check (
  auth.role() = 'service_role' or account_id = public.current_account_id()
);
```

### Publish pipeline hardening
`supabase/migrations/20250315120000_publish_pipeline_hardening.sql`
```sql
alter table public.content_items
  drop constraint if exists content_items_status_check;

alter table public.content_items
  add constraint content_items_status_check
  check (status in ('draft','scheduled','queued','publishing','posted','failed'));

create table if not exists public.worker_heartbeats (
  name text primary key,
  last_run_at timestamptz not null default now(),
  last_run_source text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.worker_heartbeats enable row level security;
create policy "Worker heartbeats managed by service role" on public.worker_heartbeats
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

```

## Environment Variables (Key for Publishing)
- CRON_SECRET (required by /api/cron/publish).
- NEXT_PUBLIC_SUPABASE_URL (used by Vercel API route and Supabase Edge functions).
- SUPABASE_SERVICE_ROLE_KEY (used by API route and Edge functions).
- MEDIA_BUCKET, MEDIA_SIGNED_URL_TTL_SECONDS (used by publish-queue and media-derivatives).
- META_GRAPH_VERSION / NEXT_PUBLIC_META_GRAPH_VERSION (Facebook/Instagram Graph API version).
- RESEND_API_KEY, RESEND_FROM, ALERT_EMAIL (publish failure emails).
- Provider OAuth secrets: FACEBOOK_APP_SECRET, GOOGLE_MY_BUSINESS_CLIENT_ID, GOOGLE_MY_BUSINESS_CLIENT_SECRET, INSTAGRAM_APP_ID/SECRET.


## Questions for Consultant
1) Are cron requests actually reaching /api/cron/publish, and what status codes are returned? (401 vs 200 vs 5xx)
2) Is publish-queue invoked and returning processed > 0? If zero, are jobs missing or stuck?
3) Are publish_jobs being created for scheduled content? If not, where is the enqueue path failing?
4) In Supabase logs, do we see publish-queue worker output and provider adapter logs?
5) Are provider errors consistent across Facebook/Instagram/GBP or specific to one platform?
6) Do we see connection metadata missing or connection status = needs_action?
7) Are story posts failing due to missing derivatives (Story derivative not available) or variant lookup failures?
8) Is production running the latest publish-queue function with variant_id and retry logic?
9) Are Supabase Edge function env vars set (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_*), and are they consistent with Vercel?


## Suggested Next Diagnostic Steps (If Consultant Needs Data)
- Log Vercel Cron response codes and body for /api/cron/publish.
- Manually invoke publish-queue via ops script to bypass Cron and confirm worker behavior.
- Query publish_jobs for queued/in_progress/failed counts and recent last_error values.
- Verify social_connections metadata fields (pageId, igBusinessId, locationId) and token expiry.
- For story posts, verify derived_variants.story exists and media_type is image.
- Confirm Supabase Edge function logs show provider responses and no missing env config.

