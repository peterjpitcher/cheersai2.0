/// <reference lib="dom" />
/// <reference lib="deno.unstable" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createFFmpeg, fetchFile } from "https://esm.sh/@ffmpeg/ffmpeg@0.12.6";

interface Payload {
  assetId: string;
}

interface MediaAssetRow {
  id: string;
  account_id: string;
  file_name: string;
  storage_path: string;
  media_type: "image" | "video";
  processed_status: "pending" | "processing" | "ready" | "failed" | "skipped";
}

const supabaseUrl = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const mediaBucket = Deno.env.get("MEDIA_BUCKET") ?? "media";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase credentials missing for media derivatives function");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const ffmpeg = createFFmpeg({ log: false });
let ffmpegLoaded = false;

async function ensureFfmpeg() {
  if (!ffmpegLoaded) {
    await ffmpeg.load();
    ffmpegLoaded = true;
  }
}

async function insertNotification(
  accountId: string,
  category: string,
  message: string,
  metadata?: Record<string, unknown>,
) {
  try {
    const { error } = await supabase
      .from("notifications")
      .insert({
        account_id: accountId,
        category,
        message,
        metadata: metadata ?? null,
      });
    if (error) {
      console.error("[media-derivatives] failed to insert notification", error);
    }
  } catch (error) {
    console.error("[media-derivatives] unexpected notification error", error);
  }
}

function normaliseError(error: unknown) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}


Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Payload | null = null;
  try {
    body = await request.json();
  } catch (error) {
    console.error("[media-derivatives] invalid payload", error);
    return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body?.assetId) {
    return Response.json({ ok: false, error: "assetId missing" }, { status: 400 });
  }

  try {
    return await processAsset(body.assetId);
  } catch (error) {
    console.error("[media-derivatives] unexpected failure", error);
    return Response.json({ ok: false, error: "Unhandled error" }, { status: 500 });
  }
});

async function processAsset(assetId: string) {
  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("id, account_id, file_name, storage_path, media_type, processed_status")
    .eq("id", assetId)
    .maybeSingle<MediaAssetRow>();

  if (error || !asset) {
    console.error("[media-derivatives] asset fetch failed", error);
    return Response.json({ ok: false, error: "Asset not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("media_assets")
    .update({ processed_status: "processing", processed_at: nowIso })
    .eq("id", assetId);

  if (asset.media_type !== "image") {
    await supabase
      .from("media_assets")
      .update({
        processed_status: "skipped",
        processed_at: nowIso,
        derived_variants: {},
      })
      .eq("id", assetId);

    await insertNotification(asset.account_id, "media_derivative_skipped", `${asset.file_name} derivatives skipped`, {
      assetId,
      mediaType: asset.media_type,
      reason: "unsupported_media_type",
    });

    return Response.json({ ok: true, skipped: true, reason: "unsupported_media_type" });
  }

  try {
    const { data: signed, error: signedError } = await supabase.storage
      .from(mediaBucket)
      .createSignedUrl(asset.storage_path, 300);

    if (signedError || !signed?.signedUrl) {
      throw new Error("Unable to create signed URL for asset");
    }

    const originalBuffer = await fetchFile(signed.signedUrl);

    await ensureFfmpeg();
    const inputName = "input";
    ffmpeg.FS("writeFile", inputName, originalBuffer);

    const variants: Array<{ name: string; args: string[]; output: string }> = [
      {
        name: "square",
        args: ["-vf", "scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350", "square.jpg"],
        output: "square.jpg",
      },
      {
        name: "story",
        args: ["-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "story.jpg"],
        output: "story.jpg",
      },
      {
        name: "landscape",
        args: ["-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080", "landscape.jpg"],
        output: "landscape.jpg",
      },
    ];

    const derivedPaths: Record<string, string> = {};

    for (const variant of variants) {
      const outputName = variant.output;
      await ffmpeg.run("-i", inputName, ...variant.args);
      const data = ffmpeg.FS("readFile", outputName);
      const storagePath = `derived/${asset.id}/${outputName}`;
      const { error: uploadError } = await supabase.storage
        .from(mediaBucket)
        .upload(storagePath, data.buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (uploadError) {
        throw uploadError;
      }
      derivedPaths[variant.name] = storagePath;
      ffmpeg.FS("unlink", outputName);
    }

    ffmpeg.FS("unlink", inputName);

    await supabase
      .from("media_assets")
      .update({
        processed_status: "ready",
        processed_at: new Date().toISOString(),
        derived_variants: derivedPaths,
      })
      .eq("id", assetId);

    return Response.json({ ok: true, derived: derivedPaths });
  } catch (error) {
    const errorMessage = normaliseError(error);
    console.error("[media-derivatives] processing failed", error);
    await supabase
      .from("media_assets")
      .update({
        processed_status: "failed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", assetId);

    await insertNotification(asset.account_id, "media_derivative_failed", `${asset.file_name} derivatives failed`, {
      assetId,
      error: errorMessage,
    });

    return Response.json({ ok: false, error: "Processing failed" }, { status: 500 });
  }
}
