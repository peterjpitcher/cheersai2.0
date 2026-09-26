import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Columns on live `link_in_bio_tiles` that are NOT NULL with no default
 * (checked against project nbkjciurhvkfpcpatbnt on 2026-09-26). Postgres checks
 * these on the proposed row of INSERT ... ON CONFLICT DO UPDATE before it looks
 * at the conflict, so an upsert that omits any of them fails even when the row
 * already exists. The in-memory table enforces the same rule so a position-only
 * upsert fails here exactly as it does in production.
 */
const LIVE_NOT_NULL_WITHOUT_DEFAULT = ["account_id", "title", "cta_label", "cta_url"] as const;

type TileRow = Record<string, unknown> & { id: string; account_id: string; position: number };
type DbError = { code: string; message: string };
type DbResult = { data: unknown; error: DbError | null };

interface FilterBuilder extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): FilterBuilder;
  in(column: string, values: unknown[]): FilterBuilder;
}

function createTilesTable(seed: TileRow[]) {
  const rows: TileRow[] = seed.map((row) => ({ ...row }));
  const updateFilters: string[][] = [];
  let failUpdatesWith: DbError | null = null;

  function filtered(apply: (matched: TileRow[]) => DbResult, filterLog?: string[]): FilterBuilder {
    const filters: Array<(row: TileRow) => boolean> = [];
    const builder: FilterBuilder = {
      eq(column, value) {
        filters.push((row) => row[column] === value);
        filterLog?.push(column);
        return builder;
      },
      in(column, values) {
        filters.push((row) => values.includes(row[column]));
        filterLog?.push(column);
        return builder;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => apply(rows.filter((row) => filters.every((matches) => matches(row)))))
          .then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const table = {
    select: () => filtered((matched) => ({ data: matched.map((row) => ({ id: row.id })), error: null })),
    update: (patch: Record<string, unknown>) => {
      const filterLog: string[] = [];
      updateFilters.push(filterLog);
      return filtered((matched) => {
        if (failUpdatesWith) return { data: null, error: failUpdatesWith };
        matched.forEach((row) => Object.assign(row, patch));
        return { data: null, error: null };
      }, filterLog);
    },
    upsert: async (payload: Record<string, unknown>[]): Promise<DbResult> => {
      for (const proposed of payload) {
        const missing = LIVE_NOT_NULL_WITHOUT_DEFAULT.find((column) => proposed[column] == null);
        if (missing) {
          return {
            data: null,
            error: {
              code: "23502",
              message: `null value in column "${missing}" of relation "link_in_bio_tiles" violates not-null constraint`,
            },
          };
        }
      }
      for (const proposed of payload) {
        const existing = rows.find((row) => row.id === proposed.id);
        if (existing) Object.assign(existing, proposed);
        else rows.push({ ...(proposed as TileRow) });
      }
      return { data: null, error: null };
    },
  };

  return {
    client: {
      from: (name: string) => {
        if (name !== "link_in_bio_tiles") throw new Error(`Unexpected table ${name}`);
        return table;
      },
    },
    rows,
    updateFilters,
    failUpdates(error: DbError) {
      failUpdatesWith = error;
    },
  };
}

function tile(id: string, accountId: string, position: number): TileRow {
  return {
    id,
    account_id: accountId,
    title: `Tile ${id}`,
    subtitle: null,
    cta_label: "Book now",
    cta_url: `https://example.com/${id}`,
    position,
  };
}

let table: ReturnType<typeof createTilesTable>;

vi.mock("@/lib/auth/server", () => ({ requireAuthContext: vi.fn() }));
vi.mock("@/lib/billing/entitlement-server", () => ({
  requireEntitledContext: vi.fn(async () => ({ supabase: table.client, accountId: "brand-a" })),
}));

const { reorderLinkInBioTiles } = await import("@/lib/link-in-bio/profile");

function positionsOf(accountId: string): Record<string, number> {
  return Object.fromEntries(
    table.rows.filter((row) => row.account_id === accountId).map((row) => [row.id, row.position]),
  );
}

describe("reorderLinkInBioTiles", () => {
  beforeEach(() => {
    table = createTilesTable([
      tile("a", "brand-a", 0),
      tile("b", "brand-a", 1),
      tile("c", "brand-a", 2),
      tile("x", "brand-b", 0),
    ]);
  });

  it("rejects a position-only upsert, as the live table does", async () => {
    const { error } = await table.client
      .from("link_in_bio_tiles")
      .upsert([{ id: "a", account_id: "brand-a", position: 2 }]);

    expect(error?.message).toContain('null value in column "title"');
  });

  it("saves the new order and leaves the tile content alone", async () => {
    await reorderLinkInBioTiles({ tileIdsInOrder: ["c", "a", "b"] });

    expect(positionsOf("brand-a")).toEqual({ c: 0, a: 1, b: 2 });
    expect(table.rows.find((row) => row.id === "c")).toMatchObject({
      title: "Tile c",
      cta_label: "Book now",
      cta_url: "https://example.com/c",
    });
  });

  it("scopes every position update to the signed-in brand", async () => {
    await reorderLinkInBioTiles({ tileIdsInOrder: ["b", "a", "c"] });

    expect(table.updateFilters).toHaveLength(3);
    for (const filters of table.updateFilters) {
      expect(filters).toEqual(expect.arrayContaining(["id", "account_id"]));
    }
    expect(positionsOf("brand-b")).toEqual({ x: 0 });
  });

  it("refuses a tile from another brand and changes nothing", async () => {
    await expect(reorderLinkInBioTiles({ tileIdsInOrder: ["x", "a", "b", "c"] })).rejects.toThrow(
      "One or more link-in-bio tiles were not found for this account",
    );

    expect(positionsOf("brand-a")).toEqual({ a: 0, b: 1, c: 2 });
    expect(positionsOf("brand-b")).toEqual({ x: 0 });
  });

  it("throws when the database rejects the update, so the caller can show the failure", async () => {
    table.failUpdates({ code: "42501", message: "permission denied for table link_in_bio_tiles" });

    await expect(reorderLinkInBioTiles({ tileIdsInOrder: ["c", "a", "b"] })).rejects.toMatchObject({
      message: "permission denied for table link_in_bio_tiles",
    });
  });
});
