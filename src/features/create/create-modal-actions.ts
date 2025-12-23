"use server";

import { DateTime } from "luxon";

import { listMediaAssets } from "@/lib/library/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export async function getCreateModalData() {
    const [mediaAssets, ownerSettings] = await Promise.all([
        listMediaAssets(),
        getOwnerSettings(),
    ]);

    const timezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(timezone);
    const rangeStart = now.startOf("month").toUTC().toJSDate();
    const rangeEnd = now.plus({ months: 2 }).endOf("month").toUTC().toJSDate();

    const plannerOverview = await getPlannerOverview({
        rangeStart,
        rangeEnd,
        includeActivity: false,
        includeTrash: false,
    });

    return {
        mediaAssets,
        plannerItems: plannerOverview.items,
        ownerTimezone: timezone,
    };
}
