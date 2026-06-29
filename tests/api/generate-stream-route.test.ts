/**
 * Tests for POST /api/create/generate-stream — Bug B regression suite.
 *
 * These tests lock the contract for the streaming preview route:
 *
 *  - Test 4: a story-placement request must NOT call OpenAI (neither the
 *    client factory nor `responses.stream`). The route must still emit a
 *    final `done` SSE event carrying `contentItemIds` so the form can
 *    render the saved drafts.
 *
 *  - Test 5: lazy-init guard. If the OpenAI client factory throws (e.g.
 *    the API key is missing), a story-only request must still succeed —
 *    the factory must be called only on the feed branch.
 *
 *  - Test 6: regression guard for the feed path. A feed request must
 *    continue to call OpenAI exactly as today and emit `done` with
 *    contentItemIds.
 *
 * The route handler streams Server-Sent Events; we collect the stream into
 * an array of decoded events for assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

// --- Hoisted mocks -----------------------------------------------------------
const {
  createServerSupabaseClientMock,
  getOwnerSettingsMock,
  getOpenAIClientMock,
  createInstantPostMock,
  responsesStreamMock,
} = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  getOwnerSettingsMock: vi.fn(),
  getOpenAIClientMock: vi.fn(),
  createInstantPostMock: vi.fn(),
  responsesStreamMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: createServerSupabaseClientMock,
}));

vi.mock("@/lib/settings/data", () => ({
  getOwnerSettings: getOwnerSettingsMock,
}));

vi.mock("@/lib/ai/client", () => ({
  getOpenAIClient: getOpenAIClientMock,
}));

vi.mock("@/lib/create/service", () => ({
  createInstantPost: createInstantPostMock,
}));

// Mock the rate limiter — the real module imports 'server-only', which the
// test runtime cannot resolve. Allow all requests through (mirrors feed-route.test).
vi.mock("@/lib/auth/rate-limit", () => ({
  getRateLimitKey: (_req: Request, prefix: string) => `test:${prefix}`,
  isRateLimited: vi.fn().mockResolvedValue(false),
}));

import { POST } from "@/app/api/create/generate-stream/route";

// --- Helpers ----------------------------------------------------------------
function buildAuthSupabaseMock(user: { id: string } | null = { id: "user-1" }) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user },
          error: user ? null : new Error("no user"),
        }),
    },
  };
}

function buildBrandFixture() {
  return {
    toneFormal: 0.5,
    tonePlayful: 0.5,
    keyPhrases: [] as string[],
    bannedTopics: [] as string[],
    bannedPhrases: [] as string[],
    defaultHashtags: [] as string[],
    defaultEmojis: [] as string[],
    instagramSignature: undefined,
    facebookSignature: undefined,
    gbpCta: "LEARN_MORE",
  };
}

function buildPostingFixture() {
  return {
    timezone: "Europe/London",
    facebookLocationId: undefined,
    instagramLocationId: undefined,
    gbpLocationId: undefined,
    defaultPostingTime: undefined,
    venueLocation: undefined,
    venueLatitude: undefined,
    venueLongitude: undefined,
    notifications: { emailFailures: false, emailTokenExpiring: false },
    gbpCtaDefaults: {
      standard: "LEARN_MORE" as const,
      event: "LEARN_MORE" as const,
      offer: "LEARN_MORE" as const,
    },
    bannerDefaults: {
      bannersEnabled: true,
      bannerPosition: "right" as const,
      bannerBg: "#a57626",
      bannerTextColour: "#ffffff",
    },
  };
}

function buildAsyncIterableStream(deltas: string[]) {
  return (async function* () {
    for (const delta of deltas) {
      yield {
        type: "response.output_text.delta",
        delta,
      } as const;
    }
  })();
}

async function readSseEvents(response: Response): Promise<unknown[]> {
  // Reads the SSE body into individual `data: ...` JSON payloads.
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const json = dataLine.slice("data: ".length);
      try {
        events.push(JSON.parse(json));
      } catch {
        // ignore parse errors on partial chunks
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    const dataLine = buffer
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (dataLine) {
      try {
        events.push(JSON.parse(dataLine.slice("data: ".length)));
      } catch {
        // noop
      }
    }
  }
  return events;
}

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/create/generate-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const STORY_BODY = {
  title: "Sunset story",
  prompt: "",
  publishMode: "now" as const,
  platforms: ["instagram"],
  media: [{ assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" }],
  placement: "story" as const,
  toneAdjust: "default" as const,
  lengthPreference: "standard" as const,
  includeHashtags: false,
  includeEmojis: false,
  ctaStyle: "default" as const,
  proofPointMode: "off" as const,
  proofPointsSelected: [],
  proofPointIntentTags: [],
};

const FEED_BODY = {
  title: "Tonight at the pub",
  prompt: "Live music tonight, doors at 8.",
  publishMode: "now" as const,
  platforms: ["facebook"],
  media: [{ assetId: "asset-1", mediaType: "image", fileName: "hero.jpg" }],
  placement: "feed" as const,
  toneAdjust: "default" as const,
  lengthPreference: "standard" as const,
  includeHashtags: false,
  includeEmojis: false,
  ctaStyle: "default" as const,
  proofPointMode: "off" as const,
  proofPointsSelected: [],
  proofPointIntentTags: [],
};

// --- Tests ------------------------------------------------------------------
describe("POST /api/create/generate-stream — Bug B regression suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServerSupabaseClientMock.mockResolvedValue(buildAuthSupabaseMock());
    getOwnerSettingsMock.mockResolvedValue({
      brand: buildBrandFixture(),
      posting: buildPostingFixture(),
      venueName: "The Anchor",
      venueLocation: "Stanwell Moor",
    });
    createInstantPostMock.mockResolvedValue({
      campaignId: "cam-1",
      contentItemIds: ["content-1"],
      status: "queued",
      scheduledFor: null,
    });
    responsesStreamMock.mockImplementation(() =>
      buildAsyncIterableStream(["Hello ", "world"]),
    );
    getOpenAIClientMock.mockReturnValue({
      responses: {
        stream: responsesStreamMock,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("[Test 4] story-only POST emits done with contentItemIds and never calls OpenAI", async () => {
    const response = await POST(buildRequest(STORY_BODY) as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readSseEvents(response);

    // Bug B guard: getOpenAIClient is at module top of the route today, so
    // it WILL be called pre-fix. After Wave 2 it must be lazy and skipped
    // for story-only requests.
    expect(getOpenAIClientMock).not.toHaveBeenCalled();
    // And the actual streaming call must never happen for stories.
    expect(responsesStreamMock).not.toHaveBeenCalled();

    // The route must still emit a final `done` event with content IDs so
    // the form can render the saved drafts.
    const doneEvent = events.find(
      (event): event is { type: "done"; contentItemIds: string[] } =>
        typeof event === "object" &&
        event !== null &&
        (event as Record<string, unknown>).type === "done",
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.contentItemIds.length).toBeGreaterThan(0);
  });

  it("[Test 5] story request still succeeds when getOpenAIClient throws (lazy-init guard)", async () => {
    getOpenAIClientMock.mockImplementation(() => {
      throw new Error("Missing OPENAI_API_KEY");
    });

    const response = await POST(buildRequest(STORY_BODY) as never);

    // Lazy-init guard: route must NOT touch the OpenAI client factory at
    // all when the placement is "story". Today the factory is called
    // before the platform loop, so this throws and the SSE stream emits
    // an `error` instead of `done` — failing this assertion.
    expect(response.status).toBe(200);

    const events = await readSseEvents(response);
    const doneEvent = events.find(
      (event): event is { type: "done"; contentItemIds: string[] } =>
        typeof event === "object" &&
        event !== null &&
        (event as Record<string, unknown>).type === "done",
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.contentItemIds.length).toBeGreaterThan(0);

    // The route must not have surfaced an `error` event for this case.
    const errorEvent = events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as Record<string, unknown>).type === "error",
    );
    expect(errorEvent).toBeUndefined();
  });

  it("[Test 6] feed POST still calls OpenAI and emits done — regression guard for the feed path", async () => {
    const response = await POST(buildRequest(FEED_BODY) as never);

    expect(response.status).toBe(200);

    const events = await readSseEvents(response);

    // The feed path must continue to call the client factory and stream
    // a generation. We assert at least one call to each so a future
    // refactor that accidentally short-circuits feed too would fail loudly.
    expect(getOpenAIClientMock).toHaveBeenCalled();
    expect(responsesStreamMock).toHaveBeenCalled();

    const doneEvent = events.find(
      (event): event is { type: "done"; contentItemIds: string[] } =>
        typeof event === "object" &&
        event !== null &&
        (event as Record<string, unknown>).type === "done",
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.contentItemIds.length).toBeGreaterThan(0);
  });

  it("carries editable banner overlay text through the stream route", async () => {
    const response = await POST(buildRequest({
      ...FEED_BODY,
      banner: {
        enabled: true,
        defaults: {
          position: "right",
          bgColour: "gold",
          textColour: "white",
          customMessage: "tonight",
        },
      },
    }) as never);

    expect(response.status).toBe(200);
    await readSseEvents(response);

    expect(createInstantPostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        banner: {
          enabled: true,
          defaults: {
            position: "right",
            bgColour: "gold",
            textColour: "white",
            customMessage: "TONIGHT",
          },
        },
      }),
    );
  });
});
