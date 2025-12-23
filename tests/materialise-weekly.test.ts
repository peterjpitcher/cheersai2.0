import { describe, expect, it, vi, beforeEach } from "vitest";
import { WeeklyMaterialiser, createDefaultConfig } from "../supabase/functions/materialise-weekly/worker";

// Mock Supabase
const mockSupabase = {
    from: vi.fn(),
};

describe("WeeklyMaterialiser", () => {
    let materialiser: WeeklyMaterialiser;
    const config = createDefaultConfig();
    config.defaultWeeksAhead = 4;
    config.dedupeWindowMinutes = 45;

    beforeEach(() => {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        materialiser = new WeeklyMaterialiser(config, mockSupabase as any);
    });

    describe("run", () => {
        it("skips if no campaigns loaded", async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({ data: [], error: null }),
            });

            const count = await materialiser.run();
            expect(count).toBe(0);
        });

        it("materialises content for a valid campaign", async () => {
            const now = new Date('2025-01-01T12:00:00Z'); // Wednesday

            // 1. Mock campaigns fetch
            const campaign = {
                id: 'camp-1',
                account_id: 'acc-1',
                name: 'Weekly Quiz',
                auto_confirm: false, // Drafts
                metadata: {
                    dayOfWeek: 5, // Friday
                    time: '19:00',
                    weeksAhead: 1
                }
            };

            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({ data: [campaign], error: null }),
            });

            // 2. Mock existing content check (empty)
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({ data: [], error: null }),
            });

            // 3. Mock content items insert
            mockSupabase.from.mockReturnValueOnce({
                insert: vi.fn().mockReturnThis(),
                select: vi.fn().mockResolvedValue({
                    data: [
                        { id: 'new-1', platform: 'facebook', scheduled_for: '2025-01-03T19:00:00.000Z' },
                        { id: 'new-2', platform: 'instagram', scheduled_for: '2025-01-03T19:00:00.000Z' }
                    ],
                    error: null
                })
            });

            // 4. Mock content variants upsert (called twice, once per item)
            mockSupabase.from.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: null }), insert: vi.fn().mockResolvedValue({ error: null }) });

            const count = await materialiser.run(now);

            // Should create 2 posts (FB + IG) for the upcoming Friday
            expect(count).toBe(2);

            // Verify notifications
            expect(mockSupabase.from).toHaveBeenCalledWith('notifications');
        });

        it("deduplicates existing slots", async () => {
            const now = new Date('2025-01-01T12:00:00Z'); // Wednesday

            // 1. Mock campaigns fetch
            const campaign = {
                id: 'camp-1',
                account_id: 'acc-1',
                name: 'Weekly Quiz',
                auto_confirm: false,
                metadata: {
                    dayOfWeek: 5, // Friday
                    time: '19:00',
                    weeksAhead: 1
                }
            };

            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({ data: [campaign], error: null }),
            });

            // 2. Mock existing content: Friday 19:00 already exists for FB
            mockSupabase.from.mockReturnValueOnce({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({
                    data: [
                        { id: 'exist-1', platform: 'facebook', placement: 'feed', scheduled_for: '2025-01-03T19:00:00.000Z', status: 'scheduled' }
                    ], error: null
                }),
            });

            // 3. Mock content items insert (Only IG should be created)
            mockSupabase.from.mockReturnValueOnce({
                insert: vi.fn().mockReturnThis(),
                select: vi.fn().mockResolvedValue({
                    data: [
                        { id: 'new-2', platform: 'instagram', scheduled_for: '2025-01-03T19:00:00.000Z' }
                    ],
                    error: null
                })
            });

            // 4. Mock variants upsert
            mockSupabase.from.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: null }), insert: vi.fn().mockResolvedValue({ error: null }) });

            const count = await materialiser.run(now);
            expect(count).toBe(1); // Only IG
        });
    });
});
