// The outbound half of the artwork import. These URLs come from another system's
// API response, so this module is what stops a compromised or misconfigured
// management app pointing the server at something it should not reach.

import { afterEach, describe, expect, it, vi } from "vitest";

const ALLOWED = "https://storage.example.supabase.co";

vi.mock("@/env", () => ({
  env: {
    server: { MANAGEMENT_ARTWORK_ORIGINS: "https://storage.example.supabase.co,https://second.example.com" },
    client: {},
  },
}));

import { ArtworkFetchError, checkArtworkUrl, fetchArtworkFile } from "@/lib/management-app/artwork-fetch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("checkArtworkUrl", () => {
  it("accepts an allowed https origin", () => {
    const result = checkArtworkUrl(`${ALLOWED}/storage/v1/object/public/event-images/a.png`);
    expect(result.ok).toBe(true);
  });

  it("accepts every configured origin, not just the first", () => {
    expect(checkArtworkUrl("https://second.example.com/a.png").ok).toBe(true);
  });

  it("refuses an origin that is not on the list", () => {
    const result = checkArtworkUrl("https://evil.example.com/a.png");
    expect(result).toEqual({ ok: false, reason: "origin_not_allowed" });
  });

  it("refuses a lookalike subdomain of an allowed host", () => {
    // Origin equality, not suffix matching: "…supabase.co.evil.com" would pass a
    // naive endsWith check.
    expect(checkArtworkUrl("https://storage.example.supabase.co.evil.com/a.png")).toEqual({
      ok: false,
      reason: "origin_not_allowed",
    });
  });

  it("refuses plain http even for an allowed host", () => {
    expect(checkArtworkUrl("http://storage.example.supabase.co/a.png")).toEqual({
      ok: false,
      reason: "not_https",
    });
  });

  it("refuses credentials embedded in the URL", () => {
    // https://allowed.host@evil.host/ is parsed differently by different
    // libraries and proxies, so userinfo is refused outright.
    expect(checkArtworkUrl(`https://user:pass@storage.example.supabase.co/a.png`)).toEqual({
      ok: false,
      reason: "userinfo_in_url",
    });
  });

  it("refuses a non-default port on an allowed host", () => {
    expect(checkArtworkUrl("https://storage.example.supabase.co:8443/a.png")).toEqual({
      ok: false,
      reason: "non_default_port",
    });
  });

  it("refuses anything that is not a URL", () => {
    expect(checkArtworkUrl("not a url").ok).toBe(false);
    expect(checkArtworkUrl("/relative/path.png").ok).toBe(false);
  });

  it("refuses other schemes that can address local resources", () => {
    for (const raw of ["file:///etc/passwd", "data:image/png;base64,AAAA", "ftp://storage.example.supabase.co/a.png"]) {
      expect(checkArtworkUrl(raw).ok).toBe(false);
    }
  });
});

describe("fetchArtworkFile", () => {
  function respondWith(body: Uint8Array, headers: Record<string, string> = {}) {
    // Typed with the real fetch signature so the assertions below can read the
    // init object, which is the whole point of these tests.
    const fetchMock: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn(async () =>
      new Response(new Blob([new Uint8Array(body)]), {
        status: 200,
        headers: { "content-type": "image/png", ...headers },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("sends no credentials of any kind to the artwork host", async () => {
    // The management API key authenticates the API. Forwarding it to a storage
    // host, especially one that turned out not to be ours, would leak it.
    const fetchMock = respondWith(new Uint8Array([1, 2, 3]));

    await fetchArtworkFile(`${ALLOWED}/a.png`);

    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("fetch was not called");
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).toEqual(["accept"]);
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("refuses to follow redirects", async () => {
    // An allowed origin that answers 302 would otherwise be a free pass past the
    // origin check.
    const fetchMock = respondWith(new Uint8Array([1]));
    await fetchArtworkFile(`${ALLOWED}/a.png`);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("classifies a rejected redirect distinctly from a network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed: unexpected redirect");
    }) as unknown as typeof fetch;

    await expect(fetchArtworkFile(`${ALLOWED}/a.png`)).rejects.toMatchObject({ kind: "redirected" });
  });

  it("rejects an off-allowlist URL before making any request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchArtworkFile("https://evil.example.com/a.png")).rejects.toBeInstanceOf(
      ArtworkFetchError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops reading once the byte cap is passed, whatever Content-Length claims", async () => {
    // Content-Length is a claim by the other end. Counting what actually arrives
    // is the only figure that bounds memory.
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;

    globalThis.fetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 1;
          if (sent > 40) {
            controller.close();
            return;
          }
          controller.enqueue(chunk);
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "10" },
      });
    }) as unknown as typeof fetch;

    await expect(fetchArtworkFile(`${ALLOWED}/big.png`)).rejects.toMatchObject({ kind: "too_large" });
    expect(sent).toBeLessThan(40);
  });

  it("surfaces a non-200 as an http error rather than empty bytes", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchArtworkFile(`${ALLOWED}/missing.png`)).rejects.toMatchObject({ kind: "http_error" });
  });

  it("reports an aborted request as a timeout", async () => {
    globalThis.fetch = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;

    await expect(fetchArtworkFile(`${ALLOWED}/slow.png`)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("returns the bytes on success", async () => {
    respondWith(new Uint8Array([9, 8, 7]));
    const result = await fetchArtworkFile(`${ALLOWED}/a.png`);
    expect(Array.from(result.bytes)).toEqual([9, 8, 7]);
    expect(result.contentType).toBe("image/png");
  });
});
