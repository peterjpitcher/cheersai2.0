import { describe, expect, it } from "vitest";

import {
    MetaGraphApiError,
    isExplicitMetaConnectionFailure,
    isRetryableMetaGraphFailure,
} from "../supabase/functions/publish-queue/providers/meta-error";

function graphPayload(error: Record<string, unknown>) {
    return { error: { type: "OAuthException", fbtrace_id: "trace-1", ...error } };
}

describe("isRetryableMetaGraphFailure", () => {
    it("treats Instagram media download failures (code 9004) as transient", () => {
        // Live failure from 2026-09-04: Meta's fetcher never requested the signed
        // image URL and returned 9004 / 2207052 even though the JPEG was valid.
        const error = new MetaGraphApiError(
            400,
            graphPayload({
                message: "Only photo or video can be accepted as media type.",
                code: 9004,
                error_subcode: 2207052,
            }),
            "instagram_create_container",
        );

        expect(error.message).toBe(
            "[instagram_create_container] status=400 OAuthException: Only photo or video can be accepted as media type. (code 9004, subcode 2207052) trace=trace-1",
        );
        expect(isExplicitMetaConnectionFailure(error.graph)).toBe(false);
        expect(isRetryableMetaGraphFailure(error.graph)).toBe(true);
    });

    it("still treats expired or invalid tokens as permanent", () => {
        const error = new MetaGraphApiError(
            400,
            graphPayload({ message: "Error validating access token", code: 190, error_subcode: 463 }),
            "instagram_create_container",
        );

        expect(isExplicitMetaConnectionFailure(error.graph)).toBe(true);
        expect(isRetryableMetaGraphFailure(error.graph)).toBe(false);
    });

    it("still treats plain validation errors as permanent", () => {
        const error = new MetaGraphApiError(
            400,
            graphPayload({ message: "Invalid parameter", code: 100, error_subcode: 33 }),
            "instagram_create_container",
        );

        expect(isRetryableMetaGraphFailure(error.graph)).toBe(false);
    });

    it("returns false when no Graph error details are available", () => {
        expect(isRetryableMetaGraphFailure(null)).toBe(false);
        expect(isRetryableMetaGraphFailure(undefined)).toBe(false);
    });
});
