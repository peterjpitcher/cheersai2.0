import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import sharp from "sharp";
import { z } from 'zod'
import { unauthorized, notFound, badRequest, serverError, ok } from '@/lib/http'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }

    const body = await request.json();
    const parsed = z.object({ assetIds: z.array(z.string().uuid()).min(1) }).safeParse(body)
    if (!parsed.success) {
      return badRequest('validation_error', 'No valid assets selected', parsed.error.format(), request)
    }
    const { assetIds } = parsed.data

    // Get watermark settings
    const { data: settings } = await supabase
      .from("watermark_settings")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (!settings?.enabled) {
      return badRequest('watermark_disabled', 'Watermarking is not enabled', undefined, request)
    }

    // Get active logo
    const { data: logo } = await supabase
      .from("tenant_logos")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!logo) {
      return notFound('No logo found', undefined, request)
    }

    // Download logo from URL
    const logoResponse = await fetch(logo.file_url);
    const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());

    // Get selected assets
    const { data: assets } = await supabase
      .from("media_assets")
      .select("*")
      .in("id", assetIds)
      .eq("tenant_id", userData.tenant_id);

    if (!assets || assets.length === 0) {
      return notFound('No assets found', undefined, request)
    }

    const results = [];

    for (const asset of assets) {
      try {
        // Skip if already has watermark
        if (asset.has_watermark) {
          results.push({ id: asset.id, status: "skipped", reason: "Already has watermark" });
          continue;
        }

        // Download original image
        const imageResponse = await fetch(asset.file_url);
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

        // Get image metadata
        const metadata = await sharp(imageBuffer).metadata();
        const imageWidth = metadata.width || 1000;
        
        // Calculate logo size
        const logoSize = Math.round((imageWidth * settings.size_percent) / 100);
        
        // Resize logo
        const resizedLogo = await sharp(logoBuffer)
          .resize(logoSize, null, { 
            fit: 'inside',
            withoutEnlargement: true 
          })
          .toBuffer();

        // Map position to Sharp gravity
        const gravityMap: { [key: string]: string } = {
          'top-left': 'northwest',
          'top-right': 'northeast',
          'bottom-left': 'southwest',
          'bottom-right': 'southeast',
        };

        // Apply watermark
        const watermarkedImage = await sharp(imageBuffer)
          .composite([{
            input: resizedLogo,
            gravity: gravityMap[settings.position] || 'southeast',
            blend: 'over',
            opacity: settings.opacity,
          }])
          .toBuffer();

        // Upload watermarked version
        const fileExt = asset.file_name.split(".").pop();
        const watermarkedFileName = `${userData.tenant_id}/watermarked/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("media")
          .upload(watermarkedFileName, watermarkedImage, {
            cacheControl: "3600",
            upsert: false,
            contentType: asset.file_type,
          });

        if (uploadError) {
          results.push({ id: asset.id, status: "error", reason: uploadError.message });
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from("media")
          .getPublicUrl(watermarkedFileName);

        // Update database record
        const { error: updateError } = await supabase
          .from("media_assets")
          .update({
            file_url: publicUrl,
            has_watermark: true,
            watermark_position: settings.position,
            original_url: asset.file_url, // Keep reference to original
          })
          .eq("id", asset.id);

        if (updateError) {
          results.push({ id: asset.id, status: "error", reason: updateError.message });
          continue;
        }

        results.push({ id: asset.id, status: "success", newUrl: publicUrl });

      } catch (error) {
        console.error(`Failed to watermark asset ${asset.id}:`, error);
        results.push({ id: asset.id, status: "error", reason: "Processing failed" });
      }
    }

    return ok({ 
      success: true,
      results,
      processed: results.filter(r => r.status === "success").length,
      skipped: results.filter(r => r.status === "skipped").length,
      failed: results.filter(r => r.status === "error").length,
    }, request);

  } catch (error) {
    console.error("Batch watermark error:", error);
    return serverError('Failed to process batch watermark', undefined, request)
  }
}
