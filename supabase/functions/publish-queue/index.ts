/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { publishToFacebook } from "./providers/facebook.ts";
import { publishToInstagram } from "./providers/instagram.ts";
import { publishToGBP } from "./providers/gbp.ts";
import { resolveConnectionMetadata } from "./metadata.ts";
import type {
  ProviderMedia,
  ProviderPlatform,
  ProviderPublishRequest,
  ProviderPublishResult,
} from "./providers/types.ts";

interface PublishJobPayload {
  leadWindowMinutes?: number;
}

interface PublishJobRow {
  id: string;
  content_item_id: string;
  status: string;
  next_attempt_at: string | null;
  attempt: number | null;
}

type ContentStatus = "draft" | "scheduled" | "publishing" | "posted" | "failed";

type VariantRow = {
  body: string | null;
  media_ids: string[] | null;
};

type ConnectionStatus = "active" | "expiring" | "needs_action";

interface ContentRow {
  id: string;
  account_id: string;
  platform: ProviderPlatform;
  scheduled_for: string | null;
  prompt_context: Record<string, unknown> | null;
  campaigns: {
    name: string | null;
  } | null;
  content_variants: VariantRow[] | VariantRow | null;
}

interface ConnectionRow {
  id: string;
  provider: ProviderPlatform;
  status: ConnectionStatus;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  display_name: string | null;
  metadata: Record<string, unknown> | null;
}

interface MediaRow {
  id: string;
  storage_path: string;
  media_type: "image" | "video";
  mime_type: string | null;
}

const supabaseUrl = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase credentials missing for publish queue function");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const MEDIA_BUCKET = Deno.env.get("MEDIA_BUCKET") ?? "media";
const MEDIA_SIGNED_URL_TTL_SECONDS = Number(Deno.env.get("MEDIA_SIGNED_URL_TTL_SECONDS") ?? 3600);
const MAX_ATTEMPTS = resolveMaxAttempts(Deno.env.get("PUBLISH_MAX_ATTEMPTS"));
const RETRY_BACKOFF_MINUTES = parseBackoff(Deno.env.get("PUBLISH_RETRY_MINUTES")) ?? [5, 15, 30];
const AUTH_ERROR_PATTERN = /token|permission|credential|unauthor|authenticat|authoriz/i;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM = Deno.env.get("RESEND_FROM");
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") ?? Deno.env.get("OWNER_ALERT_EMAIL") ?? "notifications@cheersai.uk";

async function sendEmailNotification(subject: string, html: string) {
  if (!RESEND_API_KEY || !RESEND_FROM || !ALERT_EMAIL) {
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [ALERT_EMAIL],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    console.error("[publish-queue] failed to send email", await response.text());
  }
}

function resolveMaxAttempts(value?: string | null) {
  if (!value) return 3;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 3;
  }
  return Math.floor(parsed);
}

function parseBackoff(value?: string | null) {
  if (!value) return null;
  const parts = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
  return parts.length ? parts : null;
}


async function processDueJobs(leadWindowMinutes = 5) {
  const windowIso = new Date(Date.now() + leadWindowMinutes * 60 * 1000).toISOString();
  const { data: jobs, error } = await supabase
    .from("publish_jobs")
    .select("id, content_item_id, status, next_attempt_at, attempt")
    .eq("status", "queued")
    .lte("next_attempt_at", windowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[publish-queue] publish_jobs fetch failed", error);
    return { processed: 0 };
  }

  if (!jobs?.length) {
    return { processed: 0 };
  }

  let processed = 0;

  for (const job of jobs) {
    try {
      await handleJob(job);
      processed += 1;
    } catch (err) {
      console.error(`[publish-queue] unexpected error handling job ${job.id}`, err);
    }
  }

  return { processed };
}

async function handleJob(job: PublishJobRow) {
  const now = new Date();
  const nowIso = now.toISOString();
  const currentAttempt = (job.attempt ?? 0) + 1;

  const locked = await lockJob(job.id, currentAttempt, nowIso);
  if (!locked) {
    return;
  }

  const content = await loadContent(job.content_item_id);
  if (!content) {
    await markJobMissingContent(job.id, nowIso);
    return;
  }

  const variants = normaliseVariants(content.content_variants);
  const variant = variants[0];
  const copy = variant?.body?.trim();
  if (!variant || !copy) {
    await handleFailure({
      jobId: job.id,
      content,
      attempt: currentAttempt,
      now,
      message: "No content variant available",
      retryable: false,
    });
    return;
  }

  const connection = await loadConnection(content.account_id, content.platform);
  if (!connection) {
    await handleFailure({
      jobId: job.id,
      content,
      attempt: currentAttempt,
      now,
      message: `No connection configured for ${content.platform}`,
      retryable: false,
    });
    return;
  }

  const usable = isConnectionUsable(connection, now);
  if (!usable.valid) {
    await forceConnectionNeedsAction(connection, content.account_id, usable.reason ?? "Connection unavailable", nowIso);
    await handleFailure({
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
    await forceConnectionNeedsAction(connection, content.account_id, metadataResult.error, nowIso);
    await handleFailure({
      jobId: job.id,
      content,
      attempt: currentAttempt,
      now,
      message: metadataResult.error,
      retryable: false,
    });
    await sendEmailNotification(
      `Action needed: ${connection.provider} metadata missing`,
      `<p>We could not publish <strong>${connection.provider}</strong> content because required metadata is missing.</p><p>${metadataResult.error}</p>`
    );
    return;
  }

  await markContentStatus(content.id, "publishing", nowIso);

  let media: ProviderMedia[] = [];
  try {
    media = await loadMedia(variant.media_ids ?? []);
  } catch (mediaError) {
    const message = extractErrorMessage(mediaError);
    console.error(`[publish-queue] failed to load media for ${content.id}`, mediaError);
    await handleFailure({
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
  };

  try {
    const providerResponse = await publishByPlatform(content.platform, request);
    await markJobSucceeded(job.id, providerResponse, nowIso);
    await markContentStatus(content.id, "posted", nowIso);
    await insertNotification(content.account_id, "publish_success", `Posted to ${content.platform} (${providerResponse.externalId})`, {
      jobId: job.id,
      contentId: content.id,
      providerResponse,
    });
  } catch (error) {
    const message = extractErrorMessage(error);
    const authFailure = AUTH_ERROR_PATTERN.test(message);

    await handleFailure({
      jobId: job.id,
      content,
      attempt: currentAttempt,
      now,
      message,
      retryable: !authFailure,
    });

    await sendEmailNotification(
      `Publish failed on ${content.platform}`,
      `<p>We attempted to publish content (${content.id}) to <strong>${content.platform}</strong> but it failed.</p><p><strong>Error:</strong> ${message}</p>`
    );

    if (authFailure) {
      await forceConnectionNeedsAction(connection, content.account_id, message, nowIso);
    }
  }
}

function extractErrorMessage(error: unknown) {
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

function isConnectionUsable(connection: ConnectionRow, now: Date) {
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

function getBackoffMinutes(attempt: number) {
  const index = Math.min(Math.max(attempt - 1, 0), RETRY_BACKOFF_MINUTES.length - 1);
  return RETRY_BACKOFF_MINUTES[index];
}

function normaliseStoragePath(path: string) {
  if (path.startsWith(`${MEDIA_BUCKET}/`)) {
    return path.slice(MEDIA_BUCKET.length + 1);
  }
  return path;
}

function normaliseVariants(collection: ContentRow["content_variants"]): VariantRow[] {
  if (!collection) return [];
  return Array.isArray(collection) ? collection : [collection];
}

async function lockJob(jobId: string, attempt: number, nowIso: string) {
  const { data, error } = await supabase
    .from("publish_jobs")
    .update({ status: "in_progress", attempt, updated_at: nowIso })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[publish-queue] failed to lock job ${jobId}`, error);
    return false;
  }

  return Boolean(data);
}

async function loadContent(contentItemId: string) {
  const { data, error } = await supabase
    .from("content_items")
    .select(
      "id, account_id, platform, scheduled_for, prompt_context, campaigns(name), content_variants(body, media_ids)"
    )
    .eq("id", contentItemId)
    .maybeSingle<ContentRow>();

  if (error) {
    console.error(`[publish-queue] failed to load content item ${contentItemId}`, error);
    return null;
  }

  return data ?? null;
}

async function loadConnection(accountId: string, platform: ProviderPlatform) {
  const { data, error } = await supabase
    .from("social_connections")
    .select("id, provider, status, access_token, refresh_token, expires_at, display_name, metadata")
    .eq("account_id", accountId)
    .eq("provider", platform)
    .maybeSingle<ConnectionRow>();

  if (error) {
    console.error(
      `[publish-queue] failed to load connection for account ${accountId} and ${platform}`,
      error,
    );
    return null;
  }

  return data ?? null;
}

async function loadMedia(mediaIds: string[]) {
  if (!mediaIds.length) return [];

  const { data, error } = await supabase
    .from("media_assets")
    .select("id, storage_path, media_type, mime_type")
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

  const uniquePaths = Array.from(new Set(mediaRows.map((row) => normaliseStoragePath(row.storage_path))));
  const { data: signed, error: signedError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(uniquePaths, MEDIA_SIGNED_URL_TTL_SECONDS);

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
    const normalisedPath = normaliseStoragePath(row.storage_path);
    const signedUrl = urlMap.get(normalisedPath);
    if (!signedUrl) {
      throw new Error(`Signed URL missing for media asset ${row.id}`);
    }
    return {
      id: row.id,
      url: signedUrl,
      mediaType: row.media_type,
      mimeType: row.mime_type,
    };
  });
}

async function markJobSucceeded(jobId: string, providerResponse: ProviderPublishResult, nowIso: string) {
  const { error } = await supabase
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

async function markContentStatus(contentId: string, status: ContentStatus, nowIso: string) {
  const { error } = await supabase
    .from("content_items")
    .update({ status, updated_at: nowIso })
    .eq("id", contentId);

  if (error) {
    console.error(`[publish-queue] failed to update content ${contentId} status to ${status}`, error);
  }
}

async function handleFailure({
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
  const shouldRetry = retryable && attempt < MAX_ATTEMPTS;

  if (shouldRetry) {
    const delayMinutes = getBackoffMinutes(attempt);
    const nextAttemptAt = new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString();

    const { error: jobError } = await supabase
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

    await markContentStatus(content.id, "scheduled", nowIso);

    await insertNotification(
      content.account_id,
      "publish_retry",
      `Retrying ${content.platform} post in ${delayMinutes} minute(s)`,
      {
        jobId,
        attempt,
        nextAttemptAt,
        error: message,
        contentId: content.id,
        platform: content.platform,
      },
    );
    return;
  }

  const { error: jobError } = await supabase
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

  await markContentStatus(content.id, "failed", nowIso);

  await insertNotification(content.account_id, "publish_failed", `Posting to ${content.platform} failed`, {
    jobId,
    attempt,
    error: message,
    contentId: content.id,
    platform: content.platform,
  });
}

async function forceConnectionNeedsAction(
  connection: ConnectionRow,
  accountId: string,
  reason: string,
  nowIso: string,
) {
  if (connection.status === "needs_action") {
    return;
  }

  const { error } = await supabase
    .from("social_connections")
    .update({ status: "needs_action", updated_at: nowIso })
    .eq("id", connection.id);

  if (error) {
    console.error(`[publish-queue] failed to flag connection ${connection.id}`, error);
    return;
  }

  await insertNotification(
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

async function insertNotification(
  accountId: string,
  category: string,
  message: string,
  metadata?: Record<string, unknown>,
) {
  const { error } = await supabase
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

async function markJobMissingContent(jobId: string, nowIso: string) {
  const { error } = await supabase
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

function publishByPlatform(platform: ProviderPlatform, request: ProviderPublishRequest) {
  switch (platform) {
    case "facebook":
      return publishToFacebook(request);
    case "instagram":
      return publishToInstagram(request);
    case "gbp":
      return publishToGBP(request);
    default:
      return Promise.reject(new Error(`Unsupported platform ${platform}`));
  }
}

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
  const result = await processDueJobs(leadWindowMinutes);

  return Response.json({ ok: true, ...result });
});
