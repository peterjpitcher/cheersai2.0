"use server";

import { DateTime } from "luxon";

import { listMediaAssets } from "@/lib/library/data";
import { getPlannerOverview } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

export async function getCreateModalData() {
    const [mediaAssets, ownerSettings] = await Promise.all([
        // Raise the cap above the default: the create wizard lets the user pick from
        // (and restore drafts referencing) a large library, so older assets must stay
        // resolvable rather than dropping off a 100-item window.
        listMediaAssets({ excludeTags: ["Tournament"], limit: 250 }),
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

    // Extract banner defaults from posting settings. getOwnerSettings()
    // exposes camelCase values under posting.bannerDefaults, while
    // bannerConfigResolver expects DB-shaped snake_case keys.
    const posting = ownerSettings.posting.bannerDefaults;
    const bannerDefaults = {
      banners_enabled: posting.bannersEnabled ?? true,
      banner_position: (posting.bannerPosition ?? 'right') as 'top' | 'bottom' | 'left' | 'right',
      banner_bg: posting.bannerBg ?? '#a57626',
      banner_text_colour: posting.bannerTextColour ?? '#FFFFFF',
    };

    return {
        mediaAssets,
        plannerItems: plannerOverview.items,
        ownerTimezone: timezone,
        bannerDefaults,
    };
}
