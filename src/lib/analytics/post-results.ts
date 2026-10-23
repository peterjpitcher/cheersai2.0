/**
 * Each published post's results from Meta, read once a day and stored for the Analytics page
 * (tasks/SPEC-post-results.md).
 *
 * One row per published post in analytics_snapshots, updated in place: snapshot_date is the London
 * date the post went out, so the page filters by publish date and never counts a post twice.
 * Each metric is its own Graph request, because Meta retires and renames metrics (post impressions
 * went in November 2025, post reach in June 2026) and refuses insights without read_insights or
 * instagram_manage_insights: one refused metric then costs only itself. What was refused is kept
 * in raw_data and reported, so the page can ask for the reconnect.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import { DEFAULT_TIMEZONE } from '@/lib/constants';

/** How far back posts are read: Meta's numbers settle within a few weeks. */
export const RESULTS_WINDOW_DAYS = 28;

export type ResultsPlatform = 'facebook' | 'instagram';

export interface PublishedPost {
  jobId: string;
  platform: ResultsPlatform;
  /** Meta's id for the post: the Facebook post id or the Instagram media id. */
  externalId: string;
  publishedAt: string;
}

/** A Graph GET: the parsed body on success, or Meta's error. Tokens travel in a header, never the URL. */
export type GraphGet = (
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<{ ok: true; json: unknown } | { ok: false; status: number; code: number | null; message: string }>;

export interface PostResults {
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  comments: number | null;
  shares: number | null;
  engagementCount: number | null;
  engagementRate: number | null;
  /** Every value Meta returned, by metric. */
  values: Record<string, unknown>;
  /** Metrics Meta refused, with its reason. */
  refused: Record<string, string>;
}

type Row = Record<string, unknown>;

const asRecord = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The lifetime value of one insights metric, from either shape Meta returns. */
export function insightValue(json: unknown): unknown {
  const first = asRecord(Array.isArray(asRecord(json)?.data) ? (asRecord(json)!.data as unknown[])[0] : null);
  if (!first) return null;
  const values = first.values;
  if (Array.isArray(values) && values.length) return asRecord(values[values.length - 1])?.value ?? null;
  return asRecord(first.total_value)?.value ?? null;
}

function sumKnown(...values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

async function readMetric(
  get: GraphGet,
  objectId: string,
  metric: string,
  token: string,
  results: PostResults,
): Promise<unknown> {
  const response = await get(`${objectId}/insights`, { metric }, token);
  if (!response.ok) {
    results.refused[metric] = `code ${response.code ?? response.status}: ${response.message}`.slice(0, 200);
    return null;
  }
  const value = insightValue(response.json);
  results.values[metric] = value;
  return value;
}

function emptyResults(): PostResults {
  return {
    impressions: null,
    reach: null,
    clicks: null,
    comments: null,
    shares: null,
    engagementCount: null,
    engagementRate: null,
    values: {},
    refused: {},
  };
}

function withRate(results: PostResults): PostResults {
  results.engagementRate =
    results.engagementCount !== null && results.reach !== null && results.reach > 0
      ? Number((results.engagementCount / results.reach).toFixed(4))
      : null;
  return results;
}

/** Thrown when Meta no longer knows the post, or the token is no good, so the post is skipped. */
export class PostResultsError extends Error {
  constructor(message: string, readonly tokenProblem: boolean) {
    super(message);
  }
}

function baseFailure(response: { status: number; code: number | null; message: string }): PostResultsError {
  // 190 is an expired or revoked token; 102 a session problem. Anything else is about the post.
  const tokenProblem = response.code === 190 || response.code === 102;
  return new PostResultsError(`code ${response.code ?? response.status}: ${response.message}`.slice(0, 200), tokenProblem);
}

/** A Facebook post's results: counts from the post itself, then each insights metric. */
export async function readFacebookResults(get: GraphGet, postId: string, token: string): Promise<PostResults> {
  const results = emptyResults();
  const base = await get(postId, { fields: 'shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)' }, token);
  if (!base.ok) throw baseFailure(base);
  const post = asRecord(base.json) ?? {};
  const reactions = asCount(asRecord(asRecord(post.reactions)?.summary)?.total_count);
  results.comments = asCount(asRecord(asRecord(post.comments)?.summary)?.total_count);
  // Meta leaves `shares` out when nobody has shared the post.
  results.shares = asCount(asRecord(post.shares)?.count) ?? 0;
  results.values.reactions = reactions;

  results.impressions = asCount(await readMetric(get, postId, 'post_media_view', token, results));
  results.reach = asCount(await readMetric(get, postId, 'post_total_media_view_unique', token, results));
  const clicks = asRecord(await readMetric(get, postId, 'post_clicks_by_type', token, results));
  results.clicks = clicks ? asCount(clicks['link clicks']) ?? 0 : null;

  results.engagementCount = sumKnown(reactions, results.comments, results.shares);
  return withRate(results);
}

/** An Instagram post's results: counts from the media itself, then each insights metric. */
export async function readInstagramResults(get: GraphGet, mediaId: string, token: string): Promise<PostResults> {
  const results = emptyResults();
  const base = await get(mediaId, { fields: 'like_count,comments_count' }, token);
  if (!base.ok) throw baseFailure(base);
  const media = asRecord(base.json) ?? {};
  const likes = asCount(media.like_count);
  results.comments = asCount(media.comments_count);
  results.values.likes = likes;

  results.impressions = asCount(await readMetric(get, mediaId, 'views', token, results));
  results.reach = asCount(await readMetric(get, mediaId, 'reach', token, results));
  results.shares = asCount(await readMetric(get, mediaId, 'shares', token, results));
  const saved = asCount(await readMetric(get, mediaId, 'saved', token, results));
  const total = asCount(await readMetric(get, mediaId, 'total_interactions', token, results));

  results.engagementCount = total ?? sumKnown(likes, results.comments, results.shares, saved);
  return withRate(results);
}

/** The London date a post went out, which is the row's snapshot_date. */
export function publishedLondonDate(publishedAt: string): string {
  return DateTime.fromISO(publishedAt, { setZone: true }).setZone(DEFAULT_TIMEZONE).toISODate() ?? publishedAt.slice(0, 10);
}

/** The brand's feed posts published in the window, with Meta's id for each. */
export async function loadPublishedPosts(db: SupabaseClient, accountId: string, now: Date): Promise<PublishedPost[]> {
  // In UTC, so the window is the same length whichever zone the server runs in.
  const since = DateTime.fromJSDate(now, { zone: 'utc' }).minus({ days: RESULTS_WINDOW_DAYS }).toISO();
  const { data, error } = await db
    .from('publish_jobs')
    .select('id, placement, provider_response, updated_at, content_items(platform, placement)')
    .eq('account_id', accountId)
    .eq('status', 'succeeded')
    .gte('updated_at', since)
    .returns<Array<{ id: string; placement: string | null; provider_response: unknown; updated_at: string; content_items: unknown }>>();
  if (error) throw new Error(`published posts could not be read: ${error.message}`);

  const posts: PublishedPost[] = [];
  for (const job of data ?? []) {
    const item = asRecord(Array.isArray(job.content_items) ? job.content_items[0] : job.content_items);
    const placement = job.placement ?? (typeof item?.placement === 'string' ? item.placement : null);
    const platform = item?.platform;
    if (placement !== 'feed' || (platform !== 'facebook' && platform !== 'instagram')) continue;
    const response = asRecord(job.provider_response);
    const externalId = typeof response?.externalId === 'string' ? response.externalId.trim() : '';
    if (!externalId) continue;
    const publishedAt = typeof response?.publishedAt === 'string' ? response.publishedAt : job.updated_at;
    posts.push({ jobId: job.id, platform, externalId, publishedAt });
  }
  return posts;
}

export interface AccountResultsSummary {
  posts: number;
  written: number;
  skipped: number;
  /** Each refused metric and how many posts it was refused for. */
  refused: Record<string, number>;
}

/**
 * Read and store the results of one brand's published posts. Throws when its posts cannot be
 * read or a result cannot be stored, so the cron reports a failed run.
 */
export async function syncAccountPostResults(
  {
    db,
    accountId,
    now = new Date(),
  }: { db: SupabaseClient; accountId: string; now?: Date },
  deps: { get: GraphGet; tokenFor: (platform: ResultsPlatform) => Promise<string | null>; log?: (message: string, detail: Row) => void },
): Promise<AccountResultsSummary> {
  const posts = await loadPublishedPosts(db, accountId, now);
  const summary: AccountResultsSummary = { posts: posts.length, written: 0, skipped: 0, refused: {} };
  const tokens = new Map<ResultsPlatform, string | null>();

  for (const post of posts) {
    if (!tokens.has(post.platform)) tokens.set(post.platform, await deps.tokenFor(post.platform));
    const token = tokens.get(post.platform);
    if (!token) {
      summary.skipped += 1;
      continue;
    }

    let results: PostResults;
    try {
      results = post.platform === 'facebook'
        ? await readFacebookResults(deps.get, post.externalId, token)
        : await readInstagramResults(deps.get, post.externalId, token);
    } catch (error) {
      if (!(error instanceof PostResultsError)) throw error;
      summary.skipped += 1;
      deps.log?.('post results unavailable', { accountId, jobId: post.jobId, platform: post.platform, reason: error.message });
      if (error.tokenProblem) tokens.set(post.platform, null);
      continue;
    }
    for (const metric of Object.keys(results.refused)) summary.refused[metric] = (summary.refused[metric] ?? 0) + 1;

    const { error } = await db.from('analytics_snapshots').upsert(
      {
        account_id: accountId,
        publish_job_id: post.jobId,
        platform: post.platform,
        impressions: results.impressions,
        reach: results.reach,
        engagement_count: results.engagementCount,
        engagement_rate: results.engagementRate,
        clicks: results.clicks,
        shares: results.shares,
        comments: results.comments,
        snapshot_date: publishedLondonDate(post.publishedAt),
        raw_data: {
          externalId: post.externalId,
          publishedAt: post.publishedAt,
          readAt: now.toISOString(),
          values: results.values,
          refused: results.refused,
        },
      },
      { onConflict: 'publish_job_id,platform,snapshot_date' },
    );
    if (error) throw new Error(`results could not be stored: ${error.message}`);
    summary.written += 1;
  }
  return summary;
}

/** A Graph GET over fetch, with the token in the Authorization header so it never reaches a URL or a log. */
export function createGraphGet(baseUrl: string, fetchImpl: typeof fetch = fetch): GraphGet {
  return async (path, params, token) => {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok) return { ok: true, json };
    const error = asRecord(asRecord(json)?.error);
    return {
      ok: false,
      status: response.status,
      code: typeof error?.code === 'number' ? error.code : null,
      message: typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
    };
  };
}

/** The brands that have a Facebook or Instagram connection. */
export async function loadConnectedAccounts(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from('social_connections')
    .select('account_id')
    .in('provider', ['facebook', 'instagram'])
    .returns<Array<{ account_id: string }>>();
  if (error) throw new Error(`connections could not be read: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.account_id))];
}
