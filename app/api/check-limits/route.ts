import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCampaignLimit, checkPostLimit, checkMediaLimit } from "@/lib/subscription/limits";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { type, count = 1 } = await request.json();
    
    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    
    if (!userData?.tenant_id) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    let result;
    
    switch (type) {
      case "campaign":
        result = await checkCampaignLimit(userData.tenant_id);
        break;
      case "post":
        result = await checkPostLimit(userData.tenant_id, count);
        break;
      case "media":
        result = await checkMediaLimit(userData.tenant_id);
        break;
      default:
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Limit check error:", error);
    return NextResponse.json(
      { error: "Failed to check limits" },
      { status: 500 }
    );
  }
}
