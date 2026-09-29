import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The media-derivatives entry point, loaded as the edge runtime would load it: the caller check
 * must run before anything else, so a refused request never has its body read or reaches the
 * database, and our own service-role callers still get through.
 *
 * index.ts is Deno code outside the app's tsconfig (Deno global, URL imports), so it is imported
 * by a runtime path that tsc does not follow. vitest.config.ts maps its esm.sh imports to
 * @supabase/supabase-js (mocked below) and tests/__mocks__/ffmpeg.ts. That FFmpeg mock means a
 * passing run here says nothing about whether the live function can start.
 */

const ENTRY: string = "../../../supabase/functions/media-derivatives/index.ts";
const FUNCTION_URL = "https://project-ref.supabase.co/functions/v1/media-derivatives";
const SERVICE_ROLE_KEY = "fixture-header.fixture-service-role-payload.fixture-signature";
const ASSET_ID = "8a4c2f6e-1d3b-4e5a-9c7f-0b2d4e6f8a1c";

type Handler = (request: Request) => Promise<Response>;
type DatabaseCall = { table: string; op: string };

const databaseCalls: DatabaseCall[] = [];
let assetRow: Record<string, unknown> | null = null;

const createClient = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({ createClient }));

function fakeSupabase() {
  return {
    from(table: string) {
      const query = {
        select() {
          databaseCalls.push({ table, op: "select" });
          return query;
        },
        eq() {
          return query;
        },
        async maybeSingle() {
          return { data: assetRow, error: null };
        },
        update() {
          databaseCalls.push({ table, op: "update" });
          return query;
        },
        async insert() {
          databaseCalls.push({ table, op: "insert" });
          return { error: null };
        },
      };
      return query;
    },
    storage: {
      from() {
        databaseCalls.push({ table: "storage", op: "from" });
        throw new Error("storage is not expected in these tests");
      },
    },
  };
}

async function loadFunction(env: Record<string, string | undefined>): Promise<Handler> {
  vi.resetModules();
  let handler: Handler | undefined;
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => env[name] },
    serve: (registered: Handler) => {
      handler = registered;
    },
  });
  await import(/* @vite-ignore */ ENTRY);
  if (!handler) {
    throw new Error("index.ts did not register a request handler");
  }
  return handler;
}

const liveEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  MEDIA_BUCKET: "media",
};

function post(body: string, authorization?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== undefined) {
    headers.Authorization = authorization;
  }
  return new Request(FUNCTION_URL, { method: "POST", headers, body });
}

beforeEach(() => {
  databaseCalls.length = 0;
  assetRow = null;
  createClient.mockReset();
  createClient.mockImplementation(() => fakeSupabase());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("media-derivatives caller check", () => {
  it("refuses a request with no Authorization header before reading its body", async () => {
    const handler = await loadFunction(liveEnv);
    const request = post(JSON.stringify({ assetId: ASSET_ID }));

    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(request.bodyUsed).toBe(false);
    expect(databaseCalls).toEqual([]);
  });

  it("refuses a wrong key before reading the body", async () => {
    const handler = await loadFunction(liveEnv);
    const request = post(JSON.stringify({ assetId: ASSET_ID }), "Bearer not-the-service-role-key");

    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(request.bodyUsed).toBe(false);
    expect(databaseCalls).toEqual([]);
  });

  it("refuses the key when it is sent only in the apikey header", async () => {
    const handler = await loadFunction(liveEnv);
    const request = new Request(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE_KEY },
      body: JSON.stringify({ assetId: ASSET_ID }),
    });

    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(databaseCalls).toEqual([]);
  });

  it("checks the caller before the method, so an unauthenticated GET also gets 401", async () => {
    const handler = await loadFunction(liveEnv);

    const response = await handler(new Request(FUNCTION_URL, { method: "GET" }));

    expect(response.status).toBe(401);
  });

  it("lets the service-role key through to the method check", async () => {
    const handler = await loadFunction(liveEnv);

    const response = await handler(
      new Request(FUNCTION_URL, { method: "GET", headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }),
    );

    expect(response.status).toBe(405);
  });

  it("lets the service-role key through to the payload check", async () => {
    const handler = await loadFunction(liveEnv);

    const response = await handler(post("not json", `Bearer ${SERVICE_ROLE_KEY}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Invalid JSON payload" });
    expect(databaseCalls).toEqual([]);
  });

  it("answers 404 for an unknown asset with the service-role key, reading and writing nothing else", async () => {
    const handler = await loadFunction(liveEnv);

    const response = await handler(post(JSON.stringify({ assetId: ASSET_ID }), `Bearer ${SERVICE_ROLE_KEY}`));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Asset not found" });
    expect(databaseCalls).toEqual([{ table: "media_assets", op: "select" }]);
  });

  it("does not start at all without its service-role key, so no request is ever served", async () => {
    for (const key of ["", undefined]) {
      await expect(loadFunction({ ...liveEnv, SUPABASE_SERVICE_ROLE_KEY: key })).rejects.toThrow(
        "Supabase credentials missing for media derivatives function",
      );
    }
    expect(createClient).not.toHaveBeenCalled();
  });
});
