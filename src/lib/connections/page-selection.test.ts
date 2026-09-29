import { describe, expect, it } from "vitest";

import {
  canChoosePage,
  canPostToFacebook,
  canPostToInstagram,
  resolvePageSelection,
  toManagedPage,
  type ManagedPage,
  type PageSelectionInput,
} from "@/lib/connections/page-selection";

function page(id: string, overrides: Partial<ManagedPage> = {}): ManagedPage {
  return {
    id,
    name: `Page ${id}`,
    accessToken: `token-${id}`,
    tasks: ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT", "MANAGE"],
    instagram: null,
    ...overrides,
  };
}

function withInstagram(id: string, overrides: Partial<ManagedPage> = {}): ManagedPage {
  return page(id, { instagram: { id: `ig-${id}`, username: `venue${id}`, name: null }, ...overrides });
}

function input(overrides: Partial<PageSelectionInput>): PageSelectionInput {
  return {
    provider: "facebook",
    pages: [],
    storedPageId: null,
    storedInstagramId: null,
    linkedPageId: null,
    forceChoice: false,
    ...overrides,
  };
}

function selectedId(result: ReturnType<typeof resolvePageSelection>) {
  return result.kind === "selected" ? result.page.id : result.kind;
}

describe("resolvePageSelection: Facebook", () => {
  it("connects the only Page straight away", () => {
    const result = resolvePageSelection(input({ pages: [page("1")] }));
    expect(result).toMatchObject({ kind: "selected", reason: "only" });
    expect(selectedId(result)).toBe("1");
  });

  it("asks the owner when there are several Pages and nothing is stored", () => {
    const pages = [page("1"), page("2")];
    const result = resolvePageSelection(input({ pages }));
    expect(result).toEqual({ kind: "choose", pages });
  });

  it("reconnects the stored Page when it is still returned, with no chooser", () => {
    const result = resolvePageSelection(input({ pages: [page("1"), page("2")], storedPageId: "2" }));
    expect(result).toMatchObject({ kind: "selected", reason: "stored" });
    expect(selectedId(result)).toBe("2");
  });

  it("asks the owner when the stored Page is missing and several Pages remain", () => {
    const result = resolvePageSelection(input({ pages: [page("1"), page("2")], storedPageId: "9" }));
    expect(result.kind).toBe("choose");
  });

  it("connects the only Page when the stored one is missing, as before", () => {
    const result = resolvePageSelection(input({ pages: [page("1")], storedPageId: "9" }));
    expect(selectedId(result)).toBe("1");
  });

  it("follows the Page Instagram is connected to, even over its own stored Page", () => {
    const result = resolvePageSelection(
      input({ pages: [page("1"), page("2"), page("3")], storedPageId: "1", linkedPageId: "3" }),
    );
    expect(result).toMatchObject({ kind: "selected", reason: "linked" });
    expect(selectedId(result)).toBe("3");
  });

  it("falls back to its stored Page when Instagram's Page was not returned", () => {
    const result = resolvePageSelection(input({ pages: [page("1"), page("2")], storedPageId: "2", linkedPageId: "9" }));
    expect(selectedId(result)).toBe("2");
  });

  it("always shows the chooser for Change Page, even when a stored Page matches", () => {
    const pages = [page("1"), page("2")];
    expect(resolvePageSelection(input({ pages, storedPageId: "1", linkedPageId: "1", forceChoice: true }))).toEqual({
      kind: "choose",
      pages,
    });
    expect(resolvePageSelection(input({ pages: [page("1")], forceChoice: true })).kind).toBe("choose");
  });

  it("refuses when Facebook returned no Pages", () => {
    expect(resolvePageSelection(input({ pages: [] }))).toMatchObject({ kind: "error", code: "no_pages" });
  });
});

describe("resolvePageSelection: Instagram", () => {
  const ig = (overrides: Partial<PageSelectionInput>) => input({ provider: "instagram", ...overrides });

  it("connects the only Page when it has an Instagram account", () => {
    const result = resolvePageSelection(ig({ pages: [withInstagram("1")] }));
    expect(result).toMatchObject({ kind: "selected", reason: "only" });
  });

  it("refuses when no Page has an Instagram account", () => {
    expect(resolvePageSelection(ig({ pages: [page("1"), page("2")] }))).toMatchObject({
      kind: "error",
      code: "no_instagram",
    });
    expect(resolvePageSelection(ig({ pages: [] }))).toMatchObject({ kind: "error", code: "no_pages" });
  });

  it("asks the owner when several Pages exist, even if only one has Instagram", () => {
    const result = resolvePageSelection(ig({ pages: [page("1"), withInstagram("2")] }));
    expect(result.kind).toBe("choose");
  });

  it("reconnects the stored Instagram account with no chooser", () => {
    const result = resolvePageSelection(
      ig({ pages: [withInstagram("1"), withInstagram("2")], storedInstagramId: "ig-2" }),
    );
    expect(result).toMatchObject({ kind: "selected", reason: "stored" });
    expect(selectedId(result)).toBe("2");
  });

  it("reconnects through its stored Page when the Instagram account on it changed", () => {
    const result = resolvePageSelection(
      ig({ pages: [withInstagram("1"), withInstagram("2")], storedInstagramId: "ig-old", storedPageId: "2" }),
    );
    expect(selectedId(result)).toBe("2");
  });

  it("asks the owner when its stored Page no longer has Instagram and several Pages remain", () => {
    const result = resolvePageSelection(ig({ pages: [withInstagram("1"), page("2")], storedPageId: "2" }));
    expect(result.kind).toBe("choose");
  });

  it("uses Facebook's Page when Facebook is connected, whatever is stored", () => {
    const result = resolvePageSelection(
      ig({ pages: [withInstagram("1"), withInstagram("2")], storedInstagramId: "ig-1", linkedPageId: "2" }),
    );
    expect(result).toMatchObject({ kind: "selected", reason: "linked" });
    expect(selectedId(result)).toBe("2");
  });

  it("refuses rather than using another Page when Facebook's Page has no Instagram account", () => {
    const result = resolvePageSelection(ig({ pages: [page("1"), withInstagram("2")], linkedPageId: "1" }));
    expect(result).toMatchObject({ kind: "error", code: "linked_page_without_instagram" });
  });

  it("refuses when Facebook's Page was not returned by this login", () => {
    const result = resolvePageSelection(ig({ pages: [withInstagram("2")], linkedPageId: "1" }));
    expect(result).toMatchObject({ kind: "error", code: "linked_page_missing" });
  });

  it("does not let Change Page move Instagram away from Facebook's Page", () => {
    const result = resolvePageSelection(
      ig({ pages: [withInstagram("1"), withInstagram("2")], linkedPageId: "1", forceChoice: true }),
    );
    expect(selectedId(result)).toBe("1");
  });

  it("shows the chooser for Change Page when Facebook is not connected", () => {
    const result = resolvePageSelection(
      ig({ pages: [withInstagram("1"), withInstagram("2")], storedInstagramId: "ig-1", forceChoice: true }),
    );
    expect(result.kind).toBe("choose");
  });
});

describe("who can post to a Page", () => {
  it("allows a Page with a token when Meta sent no tasks", () => {
    expect(canPostToFacebook(page("1", { tasks: null }))).toBe(true);
    expect(canPostToInstagram(withInstagram("1", { tasks: null }))).toBe(true);
  });

  it("refuses Facebook posting without CREATE_CONTENT", () => {
    const moderator = page("1", { tasks: ["ANALYZE", "ADVERTISE", "MODERATE"] });
    expect(canPostToFacebook(moderator)).toBe(false);
    expect(canChoosePage("facebook", moderator)).toBe(false);
  });

  it("allows Instagram posting with MODERATE, as Meta lists it there", () => {
    expect(canPostToInstagram(withInstagram("1", { tasks: ["ANALYZE", "MODERATE"] }))).toBe(true);
    expect(canPostToInstagram(withInstagram("1", { tasks: ["ANALYZE", "ADVERTISE"] }))).toBe(false);
  });

  it("refuses a Page without a token, and Instagram without a linked account", () => {
    expect(canPostToFacebook(page("1", { accessToken: null }))).toBe(false);
    expect(canPostToInstagram(withInstagram("1", { accessToken: null }))).toBe(false);
    expect(canChoosePage("instagram", page("1"))).toBe(false);
    expect(canChoosePage("instagram", withInstagram("1"))).toBe(true);
  });
});

describe("toManagedPage", () => {
  it("maps a /me/accounts entry", () => {
    expect(
      toManagedPage({
        id: " 123 ",
        name: "The Crown",
        access_token: "page-token",
        tasks: ["CREATE_CONTENT", 7],
        instagram_business_account: { id: "ig-9", username: "thecrown" },
      }),
    ).toEqual({
      id: "123",
      name: "The Crown",
      accessToken: "page-token",
      tasks: ["CREATE_CONTENT"],
      instagram: { id: "ig-9", username: "thecrown", name: null },
    });
  });

  it("drops entries without an id and reads missing fields as null", () => {
    expect(toManagedPage({ name: "No id" })).toBeNull();
    expect(toManagedPage(null)).toBeNull();
    expect(toManagedPage({ id: "5", instagram_business_account: { username: "no-id" } })).toEqual({
      id: "5",
      name: null,
      accessToken: null,
      tasks: null,
      instagram: null,
    });
  });
});
