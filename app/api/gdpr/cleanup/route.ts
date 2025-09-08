import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Verify the request is from our cron service
    const authHeader = request.headers.get("authorization");
    
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createClient();
    
    // Run the cleanup function to remove expired data per UK ICO guidelines
    const { data, error } = await supabase.rpc('cleanup_expired_data');
    
    if (error) {
      console.error("GDPR cleanup error:", error);
      return NextResponse.json({
        success: false,
        error: "Database cleanup failed",
        details: error.message,
        timestamp: new Date().toISOString()
      }, { status: 500 });
    }

    // Log successful cleanup
    console.log("GDPR data cleanup completed successfully at", new Date().toISOString());

    return NextResponse.json({
      success: true,
      message: "UK ICO compliant data cleanup completed",
      timestamp: new Date().toISOString(),
      actions: [
        "Permanently deleted user data older than 30 days (post soft-delete)",
        "Removed analytics data older than 2 years", 
        "Cleaned up error logs older than 90 days",
        "Marked unused media files for deletion (90 days since last use)",
        "Cleaned up expired data export files"
      ]
    });
  } catch (error) {
    console.error("GDPR cleanup job error:", error);
    return NextResponse.json({
      success: false,
      error: "GDPR cleanup job failed",
      details: error,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
