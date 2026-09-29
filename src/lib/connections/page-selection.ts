/**
 * Which Facebook Page a Facebook or Instagram login connects. Pure: no I/O.
 *
 * Rules (tasks/SPEC-facebook-page-chooser.md):
 * - One Page, or a stored Page that is still returned, connects straight away.
 * - Several Pages and no match: the owner chooses.
 * - Facebook and Instagram use the same Page. Facebook is the anchor, because
 *   only the Facebook login can post to both; an Instagram login always uses the
 *   Page Facebook is connected to.
 */

import type { Provider } from "@/lib/connections/oauth";

export interface ManagedPageInstagram {
  id: string;
  username: string | null;
  name: string | null;
}

export interface ManagedPage {
  id: string;
  name: string | null;
  /** Page access token. Server only: never send it to the browser or a log. */
  accessToken: string | null;
  /** The person's tasks on the Page (Meta `tasks`); null when Meta did not send them. */
  tasks: string[] | null;
  instagram: ManagedPageInstagram | null;
}

export type PageSelectionReason = "linked" | "stored" | "only";

export type PageSelectionErrorCode =
  | "no_pages"
  | "no_instagram"
  | "linked_page_without_instagram"
  | "linked_page_missing";

export type PageSelectionResult =
  | { kind: "selected"; page: ManagedPage; reason: PageSelectionReason }
  | { kind: "choose"; pages: ManagedPage[] }
  | { kind: "error"; code: PageSelectionErrorCode; message: string };

export interface PageSelectionInput {
  provider: Provider;
  pages: ManagedPage[];
  /** This platform's own stored metadata.pageId. */
  storedPageId: string | null;
  /** Instagram only: the stored metadata.igBusinessId. */
  storedInstagramId: string | null;
  /**
   * The other platform's stored metadata.pageId, only while that connection
   * holds an access token. For Instagram this is Facebook's Page.
   */
  linkedPageId: string | null;
  /** Change Page: show the chooser even when a stored Page matches. */
  forceChoice: boolean;
}

/** Meta's publishing requirement for a Page post (Page feed reference). */
const FACEBOOK_POSTING_TASKS = ["CREATE_CONTENT"];
/** Meta lists Instagram publishing under MODERATE; CREATE_CONTENT and MANAGE sit above it. */
const INSTAGRAM_POSTING_TASKS = ["CREATE_CONTENT", "MODERATE", "MANAGE"];

export const PAGE_SELECTION_MESSAGES: Record<PageSelectionErrorCode, string> = {
  no_pages: "No Facebook Pages found for the connected account.",
  no_instagram: "No Instagram Business Account was linked to the Facebook Pages returned by Facebook.",
  linked_page_without_instagram:
    "Instagram uses the same Page as Facebook, and that Page has no linked Instagram professional account. Link one to it, then connect Instagram again.",
  linked_page_missing:
    "Instagram uses the same Page as Facebook, but Facebook did not share that Page with CheersAI this time. Make sure your Facebook profile still manages it, then connect Instagram again.",
};

function hasAnyTask(page: ManagedPage, allowed: string[]): boolean {
  // Missing tasks never block: only a list that lacks every allowed task does.
  if (!page.tasks) return true;
  return page.tasks.some((task) => allowed.includes(task));
}

/** A token was returned and, when Meta sent tasks, they allow posting to the Page. */
export function canPostToFacebook(page: ManagedPage): boolean {
  return Boolean(page.accessToken) && hasAnyTask(page, FACEBOOK_POSTING_TASKS);
}

/** An Instagram account is linked, a token was returned and the tasks allow posting to it. */
export function canPostToInstagram(page: ManagedPage): boolean {
  return Boolean(page.instagram) && Boolean(page.accessToken) && hasAnyTask(page, INSTAGRAM_POSTING_TASKS);
}

/** Whether the owner may pick this Page in the chooser for this platform. */
export function canChoosePage(provider: Provider, page: ManagedPage): boolean {
  return provider === "facebook" ? canPostToFacebook(page) : canPostToInstagram(page);
}

function error(code: PageSelectionErrorCode): PageSelectionResult {
  return { kind: "error", code, message: PAGE_SELECTION_MESSAGES[code] };
}

function findPage(pages: ManagedPage[], pageId: string | null): ManagedPage | undefined {
  return pageId ? pages.find((page) => page.id === pageId) : undefined;
}

export function resolvePageSelection(input: PageSelectionInput): PageSelectionResult {
  return input.provider === "facebook" ? resolveFacebook(input) : resolveInstagram(input);
}

function resolveFacebook({ pages, storedPageId, linkedPageId, forceChoice }: PageSelectionInput): PageSelectionResult {
  if (!pages.length) return error("no_pages");
  if (forceChoice) return { kind: "choose", pages };

  // Instagram is connected: keep Facebook on the same Page.
  const linked = findPage(pages, linkedPageId);
  if (linked) return { kind: "selected", page: linked, reason: "linked" };

  const stored = findPage(pages, storedPageId);
  if (stored) return { kind: "selected", page: stored, reason: "stored" };

  if (pages.length === 1) return { kind: "selected", page: pages[0], reason: "only" };
  return { kind: "choose", pages };
}

function resolveInstagram({
  pages,
  storedPageId,
  storedInstagramId,
  linkedPageId,
  forceChoice,
}: PageSelectionInput): PageSelectionResult {
  if (!pages.length) return error("no_pages");
  if (!pages.some((page) => page.instagram)) return error("no_instagram");

  // Facebook is connected: Instagram must use Facebook's Page. Change Page
  // cannot override this; the owner changes the Page from the Facebook card.
  if (linkedPageId) {
    const linked = findPage(pages, linkedPageId);
    if (!linked) return error("linked_page_missing");
    if (!linked.instagram) return error("linked_page_without_instagram");
    return { kind: "selected", page: linked, reason: "linked" };
  }

  if (forceChoice) return { kind: "choose", pages };

  if (storedInstagramId) {
    const byInstagram = pages.find((page) => page.instagram?.id === storedInstagramId);
    if (byInstagram) return { kind: "selected", page: byInstagram, reason: "stored" };
  }

  const stored = findPage(pages, storedPageId);
  if (stored?.instagram) return { kind: "selected", page: stored, reason: "stored" };

  if (pages.length === 1) return { kind: "selected", page: pages[0], reason: "only" };
  return { kind: "choose", pages };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Maps one raw `/me/accounts` entry; null when it has no Page id. */
export function toManagedPage(raw: unknown): ManagedPage | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = readString(entry.id);
  if (!id) return null;

  const igRaw = entry.instagram_business_account;
  const igEntry = igRaw && typeof igRaw === "object" ? (igRaw as Record<string, unknown>) : null;
  const igId = igEntry ? readString(igEntry.id) : null;

  return {
    id,
    name: readString(entry.name),
    accessToken: readString(entry.access_token),
    tasks: Array.isArray(entry.tasks)
      ? entry.tasks.filter((task): task is string => typeof task === "string")
      : null,
    instagram:
      igEntry && igId
        ? { id: igId, username: readString(igEntry.username), name: readString(igEntry.name) }
        : null,
  };
}
