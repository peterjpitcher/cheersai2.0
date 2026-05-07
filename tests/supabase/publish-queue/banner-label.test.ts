// F6: the publish-queue worker copy of extractCampaignTiming must convert
// JS getDay() weekday (0=Sun..6=Sat — the format stored in campaign metadata)
// into a Luxon weekday (1=Mon..7=Sun) so the downstream label code uses the
// correct weekday math. The bug only manifested at the Sunday boundary.
import { describe, expect, it } from "vitest";
import { extractCampaignTiming } from "../../../supabase/functions/publish-queue/banner-label";

describe("supabase/publish-queue/banner-label extractCampaignTiming [F6]", () => {
    it("translates Sunday (JS 0) to Luxon Sunday (7)", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: 0, time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(7);
    });

    it("leaves Monday (JS 1) as Luxon 1", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: 1, time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(1);
    });

    it("leaves Saturday (JS 6) as Luxon 6", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: 6, time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(6);
    });

    it("falls back to 1 (Monday) for non-numeric input", () => {
        const result = extractCampaignTiming({
            campaign_type: "weekly",
            metadata: { dayOfWeek: "not-a-number", time: "12:00" },
        });
        expect(result.weeklyDayOfWeek).toBe(1);
    });
});
