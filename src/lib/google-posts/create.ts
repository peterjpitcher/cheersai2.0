/**
 * When Google versions are created (decision D8, as Peter set it on
 * 14 November 2026). Server only; service-role client scoped by account_id.
 *
 * - AUTOMATICALLY, from the cron, only for Facebook feed posts CREATED AFTER
 *   the brand's Google connection was last made (content_items.created_at
 *   later than the connection's metadata.connectedAt). connectedAt is used
 *   rather than social_connections.created_at because a reconnect updates the
 *   existing row, so created_at is the first connection ever, and posts made
 *   while Google was disconnected would otherwise be swept in silently. A
 *   connection with no connectedAt gets nothing automatically.
 * - Content that already existed gets a Google version ONLY through the
 *   deliberate pass: planGoogleVersionsForExistingSchedule (a dry run that
 *   creates nothing) and createGoogleVersionsForExistingSchedule (creates
 *   exactly what that dry run listed; a second run creates nothing).
 *
 * Events (D13, Peter, 26 November 2026): every Facebook feed post of an event
 * campaign gets a Google post. The earliest upcoming one, when the campaign
 * has no event-keyed Google post yet, is the event's own post (an EVENT post
 * where the details allow); every other post is a STANDARD reminder. The
 * database's partial unique index is the final guarantee of one event-keyed
 * post per event: a unique violation means "already has one".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { checkGoogleBrand, type GoogleBrand } from "@/lib/google-posts/brands";
import {
  buildGoogleVersion,
  campaignEventIsComplete,
  CREATE_GRACE_MS,
  eventFromCampaign,
  INELIGIBLE_TEXT,
  mergeMatchedEvent,
  parentIneligibility,
  type CampaignInfo,
  type ParentItem,
  type ResolvedEvent,
} from "@/lib/google-posts/build";
import type { GooglePostsDeps } from "@/lib/google-posts/deps";
import {
  createEventLookup,
  loadManagementConfig,
  noManagementLookup,
  type EventLookup,
} from "@/lib/google-posts/management-lookup";
import type { GoogleVersionInsert } from "@/lib/google-posts/model";

/** Candidate posts read per page, in post-time order. */
export const CANDIDATE_PAGE = 200;
/** The most candidate posts read per brand per pass; a plan that reached it says so. */
export const CANDIDATE_LIMIT = 2000;
/** Ids per `in` filter, so a request URL stays short. */
const IN_CHUNK = 100;

const PARENT_COLUMNS = "id, account_id, campaign_id, platform, placement, status, scheduled_for, deleted_at, created_at";

export interface PlanEntry {
  contentItemId: string;
  scheduledFor: string | null;
  campaignId: string | null;
  /** Plain words: why it is skipped or deferred, or what will be made. */
  reason: string;
  row?: GoogleVersionInsert;
}

export interface GoogleVersionPlan {
  accountId: string;
  localPostParent: string;
  generatedAt: string;
  /** Versions that would be created and could go out at their time. */
  create: PlanEntry[];
  /** Versions that would be created but held for a person (see hold_reason). */
  held: PlanEntry[];
  /** Posts that get no Google version, with the reason. */
  skipped: PlanEntry[];
  /** Posts left for a later run (the management app call limit was reached). */
  deferred: PlanEntry[];
  /** True when more upcoming posts exist than one pass reads (CANDIDATE_LIMIT): run it again later. */
  truncated?: boolean;
}

export interface CreateOutcome {
  created: string[];
  alreadyHad: string[];
  failed: Array<{ contentItemId: string; error: string }>;
  /** Plan entries not created because the post changed after the dry run. */
  changed: Array<{ contentItemId: string; reason: string }>;
}

type Scope = "new" | "existing";

function describeRow(row: GoogleVersionInsert): string {
  const kind = row.topic_type === "EVENT" ? `event post "${row.event_title ?? ""}"` : "standard post";
  const button = row.cta_type ? `, ${row.cta_type === "BOOK" ? "Book" : "Learn more"} button` : ", no button";
  return `${kind}${button}${row.state === "held" ? `, held: ${row.hold_reason}` : ""}`;
}

type RowsQuery = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function selectRows<T>(query: RowsQuery, what: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what} lookup failed: ${error.message}`);
  return (data ?? []) as T[];
}

/** The same lookup over a long id list, IN_CHUNK ids at a time. */
async function selectRowsIn<T>(ids: string[], query: (chunk: string[]) => RowsQuery, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += IN_CHUNK) {
    rows.push(...(await selectRows<T>(query(ids.slice(start, start + IN_CHUNK)), what)));
  }
  return rows;
}

/**
 * Works out which posts get a Google version. Creates nothing.
 * scope "new": the cron's automatic pass (posts created after connectedAt).
 * scope "existing": the deliberate pass over everything upcoming.
 */
export async function planGoogleVersions(
  deps: GooglePostsDeps,
  brand: GoogleBrand,
  { scope, lookup }: { scope: Scope; lookup?: EventLookup },
): Promise<GoogleVersionPlan> {
  const { db } = deps;
  const now = deps.now();
  const plan: GoogleVersionPlan = {
    accountId: brand.accountId,
    localPostParent: brand.localPostParent,
    generatedAt: now.toISOString(),
    create: [],
    held: [],
    skipped: [],
    deferred: [],
  };
  if (scope === "new" && !brand.connectedAt) return plan;

  const earliest = new Date(now.getTime() - CREATE_GRACE_MS).toISOString();

  const candidatePage = (from: string) => {
    let query = db
      .from("content_items")
      .select(PARENT_COLUMNS)
      .eq("account_id", brand.accountId)
      .is("deleted_at", null)
      .gte("scheduled_for", from);
    if (scope === "new") {
      query = query
        .eq("platform", "facebook")
        .eq("placement", "feed")
        // A post the publisher reached before this cron ran is still eligible
        // (inside the grace window), so cron order never decides whether a
        // Google version exists. "posted" is the live worker's word, "published" the Next.js one.
        .in("status", ["scheduled", "queued", "publishing", "published", "posted"])
        .gt("created_at", brand.connectedAt as string);
    }
    return query.order("scheduled_for", { ascending: true }).order("id", { ascending: true }).limit(CANDIDATE_PAGE);
  };

  // Paged by post time, so posts that already have a version can never crowd out newer ones.
  const candidates: ParentItem[] = [];
  const seen = new Set<string>();
  let from = earliest;
  while (candidates.length < CANDIDATE_LIMIT) {
    const page = await selectRows<ParentItem>(candidatePage(from), "content_items");
    const unseen = page.filter((item) => !seen.has(item.id));
    // A page holding only posts already read (a page of identical times) ends the pass.
    if (!unseen.length) break;
    for (const item of unseen) {
      seen.add(item.id);
      candidates.push(item);
    }
    if (page.length < CANDIDATE_PAGE) break;
    from = page[page.length - 1].scheduled_for as string;
  }
  if (candidates.length >= CANDIDATE_LIMIT) plan.truncated = true;
  if (!candidates.length) return plan;

  const entry = (item: ParentItem, reason: string, row?: GoogleVersionInsert): PlanEntry => ({
    contentItemId: item.id,
    scheduledFor: item.scheduled_for,
    campaignId: item.campaign_id,
    reason,
    ...(row ? { row } : {}),
  });

  // Stories, Instagram and drafts are listed (for the dry run) and never looked at again.
  const eligible: ParentItem[] = [];
  for (const item of candidates) {
    const reason = parentIneligibility(item, now);
    if (reason) plan.skipped.push(entry(item, INELIGIBLE_TEXT[reason]));
    else eligible.push(item);
  }
  if (!eligible.length) return plan;

  const ids = eligible.map((item) => item.id);
  const existing = await selectRowsIn<{ content_item_id: string }>(
    ids,
    (chunk) => db.from("gbp_posts").select("content_item_id").eq("account_id", brand.accountId).in("content_item_id", chunk),
    "gbp_posts",
  );
  const hasVersion = new Set(existing.map((row) => row.content_item_id));
  const fresh = eligible.filter((item) => {
    if (!hasVersion.has(item.id)) return true;
    plan.skipped.push(entry(item, "already has a Google version"));
    return false;
  });
  if (!fresh.length) return plan;

  const campaignIds = [...new Set(fresh.map((item) => item.campaign_id).filter((id): id is string => Boolean(id)))];
  const campaigns = campaignIds.length
    ? await selectRowsIn<CampaignInfo & { account_id: string }>(
        campaignIds,
        (chunk) => db.from("campaigns").select("id, account_id, campaign_type, name, metadata").eq("account_id", brand.accountId).in("id", chunk),
        "campaigns",
      )
    : [];
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const eventCampaignIds = campaigns.filter((campaign) => campaign.campaign_type === "event").map((campaign) => campaign.id);

  // The earliest upcoming Facebook feed post of each event campaign, and
  // whether the campaign already has its event-keyed Google post.
  const firstPostByCampaign = new Map<string, string>();
  const campaignHasEventPost = new Set<string>();
  if (eventCampaignIds.length) {
    const siblings = await selectRowsIn<ParentItem>(
      eventCampaignIds,
      (chunk) => db.from("content_items").select(PARENT_COLUMNS).eq("account_id", brand.accountId).in("campaign_id", chunk),
      "event posts",
    );
    const siblingIds = siblings.map((item) => item.id);
    const versions = siblingIds.length
      ? await selectRowsIn<{ content_item_id: string; source_event_key: string | null }>(
          siblingIds,
          (chunk) =>
            db.from("gbp_posts").select("content_item_id, source_event_key").eq("account_id", brand.accountId).in("content_item_id", chunk),
          "event versions",
        )
      : [];
    const keyedPost = new Set(versions.filter((row) => row.source_event_key).map((row) => row.content_item_id));
    const withVersion = new Set(versions.map((row) => row.content_item_id));
    for (const item of siblings) {
      if (item.campaign_id && keyedPost.has(item.id)) campaignHasEventPost.add(item.campaign_id);
    }
    // The event's own post is the earliest upcoming post that has no version yet.
    const upcoming = siblings
      .filter((item) => !parentIneligibility(item, now) && !withVersion.has(item.id))
      .sort((a, b) => Date.parse(a.scheduled_for as string) - Date.parse(b.scheduled_for as string) || a.id.localeCompare(b.id));
    for (const item of upcoming) {
      if (item.campaign_id && !firstPostByCampaign.has(item.campaign_id)) firstPostByCampaign.set(item.campaign_id, item.id);
    }
  }

  const bodies = await selectRowsIn<{ content_item_id: string; body: string | null }>(
    fresh.map((item) => item.id),
    (chunk) => db.from("content_variants").select("content_item_id, body").in("content_item_id", chunk),
    "content_variants",
  );
  const bodyById = new Map(bodies.map((row) => [row.content_item_id, row.body]));

  const eventLookup = lookup ?? brandLookup(deps, brand.accountId);

  // One management lookup per event campaign per pass, shared by all its posts.
  const resolved = new Map<string, ResolvedEvent | "deferred">();
  const resolveEvent = async (campaign: CampaignInfo): Promise<ResolvedEvent | "deferred"> => {
    const cached = resolved.get(campaign.id);
    if (cached) return cached;
    let event: ResolvedEvent | "deferred";
    if (campaignEventIsComplete(campaign)) {
      event = eventFromCampaign(campaign);
    } else {
      const known = eventFromCampaign(campaign);
      const result = await eventLookup.find({
        managementEventId: known.managementEventId,
        name: known.title,
        date: known.startDate,
        time: known.startTime,
      });
      event = result.status === "deferred" ? "deferred" : mergeMatchedEvent(campaign, result.status === "matched" ? result.event : null);
    }
    // A deferred lookup is asked again on the next post; an answer is kept.
    if (event !== "deferred") resolved.set(campaign.id, event);
    return event;
  };

  for (const item of fresh) {
    const campaign = item.campaign_id ? (campaignById.get(item.campaign_id) ?? null) : null;
    const isEvent = campaign?.campaign_type === "event";
    let event: ResolvedEvent | null = null;
    let isFirstEventPost = false;

    if (isEvent && campaign) {
      isFirstEventPost = !campaignHasEventPost.has(campaign.id) && firstPostByCampaign.get(campaign.id) === item.id;
      const found = await resolveEvent(campaign);
      if (found === "deferred") {
        plan.deferred.push(entry(item, "waiting for the management app call limit"));
        continue;
      }
      event = found;
    }

    const built = buildGoogleVersion({
      item,
      body: bodyById.get(item.id) ?? null,
      campaign,
      localPostParent: brand.localPostParent,
      now,
      isFirstEventPost,
      event,
    });
    if (!built.ok) {
      plan.skipped.push(entry(item, INELIGIBLE_TEXT[built.reason]));
      continue;
    }
    // Only one post of an event can be planned as the event's own post.
    if (isEvent && campaign && built.row.source_event_key) campaignHasEventPost.add(campaign.id);
    (built.row.state === "held" ? plan.held : plan.create).push(entry(item, describeRow(built.row), built.row));
  }

  return plan;
}

/** The brand's management lookup. Its connection is read only when a lookup is first needed. */
function brandLookup(deps: GooglePostsDeps, accountId: string, canCall: () => boolean = () => true): EventLookup {
  let real: Promise<EventLookup> | null = null;
  let made = (): number => 0;
  const load = async (): Promise<EventLookup> => {
    if (!deps.management) return noManagementLookup("no management app client");
    const config = await loadManagementConfig(deps.db, accountId);
    if (!config) return noManagementLookup("management import is not set up for this brand");
    const lookup = createEventLookup({ config, client: deps.management, sleep: deps.sleep, accountId, canCall });
    made = lookup.calls;
    return lookup;
  };
  return {
    find: async (query) => {
      real ??= load();
      return (await real).find(query);
    },
    calls: () => made(),
  };
}

/** Inserts one version. A unique violation means the post (or its event) already has one. */
export async function insertGoogleVersion(
  db: SupabaseClient,
  row: GoogleVersionInsert,
): Promise<"created" | "already_had" | { error: string }> {
  const { error } = await db.from("gbp_posts").insert(row);
  if (!error) return "created";
  if ((error as { code?: string }).code === "23505") return "already_had";
  return { error: error.message };
}

async function insertAll(db: SupabaseClient, entries: PlanEntry[]): Promise<CreateOutcome> {
  const outcome: CreateOutcome = { created: [], alreadyHad: [], failed: [], changed: [] };
  for (const item of entries) {
    if (!item.row) continue;
    const result = await insertGoogleVersion(db, item.row);
    if (result === "created") outcome.created.push(item.contentItemId);
    else if (result === "already_had") outcome.alreadyHad.push(item.contentItemId);
    else outcome.failed.push({ contentItemId: item.contentItemId, error: result.error });
  }
  return outcome;
}

/** The cron's automatic pass for one brand: posts created after the connection (D8). */
export async function createVersionsForNewContent(
  deps: GooglePostsDeps,
  brand: GoogleBrand,
  { canCallManagement = () => true }: { canCallManagement?: () => boolean } = {},
): Promise<CreateOutcome & { deferred: number }> {
  const lookup = brandLookup(deps, brand.accountId, canCallManagement);
  const plan = await planGoogleVersions(deps, brand, { scope: "new", lookup });
  const outcome = await insertAll(deps.db, [...plan.create, ...plan.held]);
  return { ...outcome, deferred: plan.deferred.length };
}

async function requireBrand(deps: GooglePostsDeps, accountId: string): Promise<GoogleBrand> {
  const check = await checkGoogleBrand(deps.db, accountId);
  if (!check.ok) {
    throw new Error(
      check.reason === "switched_off"
        ? "Google posting is not switched on for this brand."
        : check.reason === "connection_missing"
          ? "This brand has no active Google connection."
          : "The brand could not be checked. Try again.",
    );
  }
  return check.brand;
}

/**
 * Dry run of the deliberate pass over the existing schedule (D8): what would
 * be created, held, skipped and why. Creates nothing.
 */
export async function planGoogleVersionsForExistingSchedule(
  accountId: string,
  deps?: GooglePostsDeps,
): Promise<GoogleVersionPlan> {
  const resolved = deps ?? (await (await import("@/lib/google-posts/deps")).defaultGooglePostsDeps());
  const brand = await requireBrand(resolved, accountId);
  return planGoogleVersions(resolved, brand, { scope: "existing" });
}

/**
 * Creates exactly the versions a dry run listed (its `create` and `held`
 * entries), after checking each post is unchanged: same brand, same Google
 * location, same scheduled time, still a scheduled Facebook feed post. A post
 * that already has a version is counted, not duplicated, so a second run
 * creates nothing.
 */
export async function createGoogleVersionsForExistingSchedule(
  accountId: string,
  plan: GoogleVersionPlan,
  deps?: GooglePostsDeps,
): Promise<CreateOutcome> {
  const resolved = deps ?? (await (await import("@/lib/google-posts/deps")).defaultGooglePostsDeps());
  if (plan.accountId !== accountId) throw new Error("This plan was made for a different brand.");
  const brand = await requireBrand(resolved, accountId);
  if (brand.localPostParent !== plan.localPostParent) {
    throw new Error("The Google location has changed since the dry run. Run the dry run again.");
  }

  const entries = [...plan.create, ...plan.held].filter((item) => item.row);
  const outcome: CreateOutcome = { created: [], alreadyHad: [], failed: [], changed: [] };
  if (!entries.length) return outcome;

  const now = resolved.now();
  const parents = await selectRowsIn<ParentItem>(
    entries.map((item) => item.contentItemId),
    (chunk) => resolved.db.from("content_items").select(PARENT_COLUMNS).eq("account_id", accountId).in("id", chunk),
    "content_items",
  );
  const parentById = new Map(parents.map((item) => [item.id, item]));

  const ready: PlanEntry[] = [];
  for (const item of entries) {
    const parent = parentById.get(item.contentItemId);
    const reason = !parent
      ? "the post no longer exists"
      : parentIneligibility(parent, now)
        ? INELIGIBLE_TEXT[parentIneligibility(parent, now) as keyof typeof INELIGIBLE_TEXT]
        : parent.scheduled_for !== item.scheduledFor && Date.parse(parent.scheduled_for ?? "") !== Date.parse(item.scheduledFor ?? "")
          ? "its scheduled time changed"
          : item.row?.account_id !== accountId || item.row?.local_post_parent !== brand.localPostParent
            ? "the plan entry is for a different brand or location"
            : null;
    if (reason) outcome.changed.push({ contentItemId: item.contentItemId, reason });
    else ready.push(item);
  }

  const inserted = await insertAll(resolved.db, ready);
  return { ...inserted, changed: outcome.changed };
}
