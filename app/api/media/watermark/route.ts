import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import sharp from "sharp";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    // Get watermark settings
    const { data: settings } = await supabase
      .from("watermark_settings")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .single();

    if (!settings?.enabled) {
      return NextResponse.json({ error: "Watermarking is not enabled" }, { status: 400 });
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
      return NextResponse.json({ error: "No logo found" }, { status: 404 });
    }

    const formData = await request.formData();
    const imageFile = formData.get("image") as File;
    const position = formData.get("position") as string || settings.position;

    if (!imageFile) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // Download logo from URL
    const logoResponse = await fetch(logo.file_url);
    const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());

    // Process image with Sharp
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    
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
        gravity: gravityMap[position] || 'southeast',
        blend: 'over',
        opacity: settings.opacity,
      }])
      .toBuffer();

    // Return the watermarked image
    return new NextResponse(watermarkedImage, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    });

  } catch (error) {
    console.error("Watermark error:", error);
    return NextResponse.json(
      { error: "Failed to apply watermark" },
      { status: 500 }
    );
  }
}

// Endpoint to preview watermark position
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
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

    return NextResponse.json({
      settings: settings || {
        enabled: false,
        position: 'bottom-right',
        opacity: 0.8,
        size_percent: 15,
        margin_pixels: 20,
        auto_apply: false,
      },
      logos: logos || [],
    });

  } catch (error) {
    console.error("Get watermark settings error:", error);
    return NextResponse.json(
      { error: "Failed to get watermark settings" },
      { status: 500 }
    );
  }
}
