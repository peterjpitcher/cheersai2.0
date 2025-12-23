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

        const { data: variantRows, error: variantError } = await this.supabase
            .from("content_variants")
            .select("id, content_item_id")
            .in("content_item_id", missingContent.map((row) => row.id));

        if (variantError) {
            console.error("[publish-queue] failed to load variants for scheduled content", variantError);
            return;
        }

        const variantIdByContent = new Map(
            (variantRows ?? []).map((row) => [row.content_item_id, row.id]),
        );

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
