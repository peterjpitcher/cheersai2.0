import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getManagementEventDetail,
  listManagementEvents,
  listManagementMenuSpecials,
  ManagementApiError,
  type ManagementApiConfig,
} from "@/lib/management-app/client";

const TEST_CONFIG: ManagementApiConfig = {
  baseUrl: "https://management.example.com",
  apiKey: "anch_test_key",
};

const fetchMock = vi.fn();

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("management app client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps event envelopes and normalizes list values", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          events: [
            {
              id: "evt-1",
              name: "Quiz Night",
              date: "2026-03-12",
              time: "9:30",
              event_status: "published",
            },
          ],
        },
      }),
    );

    const result = await listManagementEvents(TEST_CONFIG, { limit: 150 });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://management.example.com/api/events?limit=100",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: expect.objectContaining({
          "X-API-Key": "anch_test_key",
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "evt-1",
      name: "Quiz Night",
      date: "2026-03-12",
      time: "09:30",
      event_status: "published",
    });
  });

  it("passes event search text to the management API", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          events: [],
        },
      }),
    );

    await listManagementEvents(TEST_CONFIG, { limit: 20, query: "quiz night" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://management.example.com/api/events?limit=20&search=quiz+night",
      expect.any(Object),
    );
  });

  it("derives date/time from startDate when list payload omits date/time", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          events: [
            {
              id: "evt-2",
              name: "Music Bingo",
              slug: "music-bingo-2026-03-11",
              startDate: "2026-03-11T20:30:00+00:00",
              event_status: "scheduled",
            },
          ],
        },
      }),
    );

    const result = await listManagementEvents(TEST_CONFIG, { limit: 10 });
    expect(result[0]).toMatchObject({
      id: "evt-2",
      date: "2026-03-11",
      time: "20:30",
    });
  });

  it("maps 401 event detail responses to UNAUTHORIZED errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { success: false }));

    const pending = getManagementEventDetail(TEST_CONFIG, "evt-1");

    await expect(pending).rejects.toBeInstanceOf(ManagementApiError);
    await expect(pending).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("includes upstream management error messages for non-2xx responses", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, {
        success: false,
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to load event message templates",
        },
      }),
    );

    await expect(getManagementEventDetail(TEST_CONFIG, "evt-500")).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 500,
      message: "Management API request failed (500): Failed to load event message templates.",
    });
  });

  it("retries event detail lookup by slug when id lookup returns 404", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { success: false }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          data: {
            id: "evt-1",
            name: "Quiz Night",
            slug: "quiz-night",
          },
        }),
      );

    const result = await getManagementEventDetail(TEST_CONFIG, "evt-1", {
      fallbackSlug: "quiz-night",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://management.example.com/api/events/evt-1",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://management.example.com/api/events/quiz-night",
      expect.any(Object),
    );
    expect(result.id).toBe("evt-1");
  });

  it("parses event detail shortlink fields", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          id: "evt-3",
          name: "Open Mic",
          facebookShortLink: "https://vip-club.uk/fb-open-mic",
          link_in_bio_short_link: "https://vip-club.uk/bio-open-mic",
        },
      }),
    );

    const result = await getManagementEventDetail(TEST_CONFIG, "evt-3");

    expect(result.facebookShortLink).toBe("https://vip-club.uk/fb-open-mic");
    expect(result.link_in_bio_short_link).toBe("https://vip-club.uk/bio-open-mic");
  });

  it("rejects specials payloads that do not include data", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));

    await expect(listManagementMenuSpecials(TEST_CONFIG)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("maps fetch failures to NETWORK errors", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    await expect(listManagementEvents(TEST_CONFIG)).rejects.toMatchObject({
      code: "NETWORK",
    });
  });
});
