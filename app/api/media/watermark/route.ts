import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import sharp from "sharp";
import { unauthorized, badRequest, notFound, serverError, ok } from '@/lib/http'
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { createServiceFetch } from '@/lib/reliability/timeout'
import { withRetry } from '@/lib/reliability/retry'

export const runtime = 'nodejs'

const storageFetch = createServiceFetch('storage')

export async function POST(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
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

    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const position = (formData.get("position") as string) || settings.position;
    const opacityOverride = formData.get('opacity') as string | null
    const sizeOverride = formData.get('size_percent') as string | null
    const marginOverride = formData.get('margin_pixels') as string | null

    if (!imageFile) {
      return badRequest('no_image', 'No image provided', undefined, request)
    }

    // Download logo from URL
    const logoResponse = await withRetry(() => storageFetch(logo.file_url), {
      maxAttempts: 3,
      initialDelay: 500,
      maxDelay: 2500,
    })
    const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());

    // Process image with Sharp
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const imageWidth = metadata.width || 1000;
    
    // Calculate logo size
    const sizePercent = sizeOverride ? Math.min(100, Math.max(1, parseInt(sizeOverride))) : settings.size_percent
    const logoSize = Math.round((imageWidth * sizePercent) / 100);
    
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
    const margin = marginOverride ? Math.max(0, parseInt(marginOverride)) : (settings.margin_pixels ?? 0)
    const base = sharp(imageBuffer)
    const watermarkedImage = await base
      .composite([
        {
          input: resizedLogo,
          gravity: gravityMap[position] || 'southeast',
          blend: 'over',
          // TS type for sharp overlay may not include 'opacity' in some versions; cast for compatibility
          ...(opacityOverride || settings.opacity ? { opacity: opacityOverride ? Math.min(1, Math.max(0.05, parseFloat(opacityOverride))) : settings.opacity } : {}),
        } as any,
      ])
      .toBuffer();

    // Return the watermarked image
    reqLogger.info('Watermark applied successfully', {
      area: 'media',
      op: 'watermark.apply',
      status: 'ok',
      meta: {
        position,
        tenantId: userData.tenant_id,
        sizePercent,
      },
    })

    return new NextResponse(watermarkedImage as any, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Watermark processing failed', {
      area: 'media',
      op: 'watermark.apply',
      status: 'fail',
      error: err,
    })
    logger.error('Media watermark error', {
      area: 'media',
      op: 'watermark.apply',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to apply watermark', undefined, request)
  }
}

// Endpoint to preview watermark position
export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return unauthorized('Authentication required', undefined, request)
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return notFound('No tenant found', undefined, request)
    }

    // Get watermark settings
    const { data: settings } = await supabase
      .from("watermark_settings")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    // Get logos
    const { data: logos } = await supabase
      .from("tenant_logos")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false });

    return ok({
      settings: settings || {
        enabled: false,
        position: 'bottom-right',
        opacity: 0.8,
        size_percent: 15,
        margin_pixels: 20,
        auto_apply: false,
      },
      logos: logos || [],
    }, request);

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Failed to fetch watermark settings', {
      area: 'media',
      op: 'watermark.fetch-settings',
      status: 'fail',
      error: err,
    })
    logger.error('Watermark settings fetch error', {
      area: 'media',
      op: 'watermark.fetch-settings',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to get watermark settings', undefined, request)
  }
}
