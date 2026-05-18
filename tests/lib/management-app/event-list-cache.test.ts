import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEventListCacheKey,
  clearEventListCache,
  getCachedEventList,
} from "@/lib/management-app/event-list-cache";

describe("event-list-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearEventListCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearEventListCache();
  });

  const baseParts = {
    accountId: "acct-1",
    baseUrl: "https://management.example.com",
    apiKey: "test-api-key-12345",
    limit: 50,
    query: undefined as string | undefined,
  };

  it("should call the fetcher on first access and return the result", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const key = buildEventListCacheKey(baseParts);

    const result = await getCachedEventList(key, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toEqual([{ id: "evt-1" }]);
  });

  it("should return cached result within 30s without calling the fetcher again", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const key = buildEventListCacheKey(baseParts);

    await getCachedEventList(key, fetcher);

    vi.advanceTimersByTime(29_000);

    const fetcher2 = vi.fn().mockResolvedValue([{ id: "evt-2" }]);
    const result = await getCachedEventList(key, fetcher2);

    expect(fetcher2).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: "evt-1" }]);
  });

  it("should expire the entry after 30s and call the fetcher again", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const key = buildEventListCacheKey(baseParts);

    await getCachedEventList(key, fetcher);

    vi.advanceTimersByTime(31_000);

    const fetcher2 = vi.fn().mockResolvedValue([{ id: "evt-2" }]);
    const result = await getCachedEventList(key, fetcher2);

    expect(fetcher2).toHaveBeenCalledOnce();
    expect(result).toEqual([{ id: "evt-2" }]);
  });

  it("should use separate cache entries for different key components", async () => {
    const fetcherA = vi.fn().mockResolvedValue([{ id: "a" }]);
    const fetcherB = vi.fn().mockResolvedValue([{ id: "b" }]);
    const fetcherC = vi.fn().mockResolvedValue([{ id: "c" }]);
    const fetcherD = vi.fn().mockResolvedValue([{ id: "d" }]);
    const fetcherE = vi.fn().mockResolvedValue([{ id: "e" }]);

    const keyA = buildEventListCacheKey(baseParts);
    const keyB = buildEventListCacheKey({ ...baseParts, accountId: "acct-2" });
    const keyC = buildEventListCacheKey({ ...baseParts, baseUrl: "https://other.example.com" });
    const keyD = buildEventListCacheKey({ ...baseParts, query: "live music" });
    const keyE = buildEventListCacheKey({ ...baseParts, apiKey: "different-key-98765" });

    expect(new Set([keyA, keyB, keyC, keyD, keyE]).size).toBe(5);

    const resultA = await getCachedEventList(keyA, fetcherA);
    const resultB = await getCachedEventList(keyB, fetcherB);
    const resultC = await getCachedEventList(keyC, fetcherC);
    const resultD = await getCachedEventList(keyD, fetcherD);
    const resultE = await getCachedEventList(keyE, fetcherE);

    expect(resultA).toEqual([{ id: "a" }]);
    expect(resultB).toEqual([{ id: "b" }]);
    expect(resultC).toEqual([{ id: "c" }]);
    expect(resultD).toEqual([{ id: "d" }]);
    expect(resultE).toEqual([{ id: "e" }]);

    expect(fetcherA).toHaveBeenCalledOnce();
    expect(fetcherB).toHaveBeenCalledOnce();
    expect(fetcherC).toHaveBeenCalledOnce();
    expect(fetcherD).toHaveBeenCalledOnce();
    expect(fetcherE).toHaveBeenCalledOnce();
  });

  it("should empty all entries when clearEventListCache is called", async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: "evt-1" }]);
    const keyA = buildEventListCacheKey(baseParts);
    const keyB = buildEventListCacheKey({ ...baseParts, accountId: "acct-2" });

    await getCachedEventList(keyA, fetcher);
    await getCachedEventList(keyB, fetcher);

    clearEventListCache();

    const fetcher2 = vi.fn().mockResolvedValue([{ id: "evt-fresh" }]);
    const result = await getCachedEventList(keyA, fetcher2);

    expect(fetcher2).toHaveBeenCalledOnce();
    expect(result).toEqual([{ id: "evt-fresh" }]);
  });
});
