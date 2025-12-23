/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { WeeklyMaterialiser, createDefaultConfig } from "./worker.ts";

const config = createDefaultConfig();
const materialiser = new WeeklyMaterialiser(config);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const now = new Date();

  // Parse payload (optional, unused currently but good practice)
  try {
    await request.json();
  } catch {
    // Ignore invalid JSON
  }

  try {
    const createdCount = await materialiser.run(now);
    return Response.json({ ok: true, created: createdCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
