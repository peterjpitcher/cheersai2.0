/**
 * What the chooser page renders. Built from the decrypted hand-off on the
 * server, field by field, so the Meta user token can never reach the browser.
 * Pure and browser-safe: no crypto, no database.
 */

import type { PageChoiceFailure } from "@/lib/connections/page-choice";

type Provider = "facebook" | "instagram";

export interface PageChoiceOptionView {
  id: string;
  name: string;
  instagramUsername: string | null;
  hasInstagram: boolean;
  selectable: boolean;
  /** This platform is connected to this Page now (Change Page). */
  connectedNow: boolean;
  /** Why the Page cannot be picked. */
  note: string | null;
  /** Facebook chooser only: what picking this Page does to a connected Instagram. */
  instagramEffect: string | null;
}

export interface PageChoiceView {
  /** The random reference already in the URL; not a secret on its own. */
  token: string;
  provider: Provider;
  changePage: boolean;
  brandName: string | null;
  /** Facebook chooser with Instagram connected: show the same-Page warning. */
  instagramConnected: boolean;
  options: PageChoiceOptionView[];
}

interface PageChoiceViewInput {
  token: string;
  brandName: string | null;
  payload: {
    provider: Provider;
    changePage: boolean;
    currentPageId: string | null;
    instagramPageId: string | null;
    pages: Array<{
      id: string;
      name: string | null;
      instagramUsername: string | null;
      hasInstagram: boolean;
      canPostToFacebook: boolean;
      canPostToInstagram: boolean;
    }>;
  };
}

/**
 * Everything the chooser screen can show, decided on the server. One client
 * component renders every case, so its own state (a failed pick, say)
 * survives the server re-render Next.js does after a server action.
 */
export type PageChooserState =
  | { kind: "choose"; view: PageChoiceView }
  | { kind: "unavailable"; message: string; provider: Provider | null; changePage: boolean; canStartAgain: boolean };

export const PAGE_CHOICE_FAILURE_MESSAGES: Record<PageChoiceFailure, string> = {
  not_found: "We could not find this Page choice. Start again from the Connections screen.",
  invalid: "We could not find this Page choice. Start again from the Connections screen.",
  forbidden: "We could not find this Page choice. Start again from the Connections screen.",
  lookup_failed: "We could not load this Page choice. Please try again in a minute.",
  used: "This Page choice has already been used. If your Page is not connected yet, start again from the Connections screen.",
  expired: "This Page choice has expired. Start again to see your Pages.",
};

/** An expired choice looked at again, once Start again can no longer be offered. */
export const PAGE_CHOICE_EXPIRED_FROM_CONNECTIONS = "This Page choice has expired. Start again from the Connections screen.";

export function buildPageChoiceView({ token, brandName, payload }: PageChoiceViewInput): PageChoiceView {
  const instagramPageId = payload.provider === "facebook" ? payload.instagramPageId : null;

  const options = payload.pages.map((page): PageChoiceOptionView => {
    const selectable = payload.provider === "facebook" ? page.canPostToFacebook : page.canPostToInstagram;

    let note: string | null = null;
    if (!selectable) {
      if (payload.provider === "instagram" && !page.hasInstagram) {
        note = "No Instagram professional account is linked to this Page.";
      } else if (payload.provider === "instagram") {
        note = "Your Facebook profile cannot post to this Instagram account.";
      } else {
        note = "Your Facebook profile cannot post to this Page.";
      }
    }

    let instagramEffect: string | null = null;
    if (selectable && instagramPageId && page.id !== instagramPageId) {
      instagramEffect = page.canPostToInstagram
        ? `Instagram moves to ${page.instagramUsername ? `@${page.instagramUsername}` : "this Page's account"}.`
        : "Instagram will be disconnected, as this Page has no account CheersAI can post to.";
    }

    return {
      id: page.id,
      name: page.name ?? "Unnamed Page",
      instagramUsername: page.instagramUsername,
      hasInstagram: page.hasInstagram,
      selectable,
      connectedNow: payload.currentPageId === page.id,
      note,
      instagramEffect,
    };
  });

  return {
    token,
    provider: payload.provider,
    changePage: payload.changePage,
    brandName,
    instagramConnected: Boolean(instagramPageId),
    options,
  };
}
