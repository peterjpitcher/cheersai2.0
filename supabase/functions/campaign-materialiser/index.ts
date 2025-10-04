/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase credentials missing for campaign materialiser");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const MATERIALISE_WINDOW_DAYS = 14;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + MATERIALISE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, metadata")
    .eq("campaign_type", "weekly")
    .eq("status", "scheduled");

  if (error) {
    console.error("campaign fetch failed", error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  let created = 0;

  for (const campaign of campaigns ?? []) {
    const cadence = parseCadence(campaign.metadata);
    if (!cadence.length) continue;

    for (const slot of buildSlots(cadence, now, windowEnd)) {
      const { data: existing } = await supabase
        .from("content_items")
        .select("id")
        .eq("campaign_id", campaign.id)
        .eq("platform", slot.platform)
        .eq("scheduled_for", slot.scheduledFor.toISOString())
        .maybeSingle();

      if (existing) continue;

      await supabase
        .from("content_items")
        .insert({
          campaign_id: campaign.id,
          account_id: slot.accountId,
          platform: slot.platform,
          scheduled_for: slot.scheduledFor.toISOString(),
          status: "scheduled",
          prompt_context: {
            source: "recurring",
          },
          auto_generated: true,
        })
        .throwOnError();

      created += 1;
    }
  }

  return Response.json({ ok: true, created });
});

function parseCadence(metadata: Record<string, unknown> | null) {
  const entries = (metadata?.cadence as CadenceEntry[] | undefined) ?? [];
  return entries.filter((entry) =>
    typeof entry.weekday === "number" &&
    typeof entry.hour === "number" &&
    typeof entry.minute === "number" &&
    ["facebook", "instagram", "gbp"].includes(entry.platform)
  );
}

interface CadenceEntry {
  platform: "facebook" | "instagram" | "gbp";
  weekday: number;
  hour: number;
  minute: number;
}

function buildSlots(cadence: CadenceEntry[], start: Date, end: Date) {
  const slots: Array<{ accountId: string; platform: CadenceEntry["platform"]; scheduledFor: Date }> = [];
  const accountId = "00000000-0000-0000-0000-000000000001";

  const pointer = new Date(start);
  pointer.setHours(0, 0, 0, 0);

  while (pointer <= end) {
    for (const entry of cadence) {
      const target = new Date(pointer);
      const diffToWeekday = (entry.weekday - target.getDay() + 7) % 7;
      target.setDate(target.getDate() + diffToWeekday);
      target.setHours(entry.hour, entry.minute, 0, 0);

      if (target < start || target > end) continue;

      slots.push({ accountId, platform: entry.platform, scheduledFor: new Date(target) });
    }

    pointer.setDate(pointer.getDate() + 7);
  }

  return slots;
}
