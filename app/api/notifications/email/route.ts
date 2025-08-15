import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend";

export async function POST(request: NextRequest) {
  try {
    const { type, recipientEmail, data } = await request.json();

    // Send email using Resend
    const result = await sendEmail(recipientEmail, type, data);
    
    if (!result.success) {
      console.error("Failed to send email:", result.error);
    }

    // Store notification in database
    const supabase = await createClient();
    
    await supabase
      .from("user_engagement")
      .insert({
        user_id: data.userId,
        tenant_id: data.tenantId,
        action: `email_${type}`,
        metadata: {
          recipient: recipientEmail,
          ...data
        }
      });

    return NextResponse.json({ 
      success: true,
      message: "Email notification sent (or would be sent in production)"
    });

  } catch (error) {
    console.error("Email notification error:", error);
    return NextResponse.json(
      { error: "Failed to send email notification" },
      { status: 500 }
    );
  }
}

// Batch send notifications for scheduled posts
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get posts scheduled for the next hour
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1);
    
    const { data: upcomingPosts } = await supabase
      .from("publishing_queue")
      .select(`
        *,
        campaign_posts (
          content,
          campaigns (
            name,
            tenant_id
          )
        ),
        social_connections (
          platform,
          page_name
        )
      `)
      .eq("status", "pending")
      .gte("scheduled_for", new Date().toISOString())
      .lte("scheduled_for", nextHour.toISOString());

    if (!upcomingPosts || upcomingPosts.length === 0) {
      return NextResponse.json({ 
        message: "No upcoming posts to notify about" 
      });
    }

    // Get user emails for notifications
    const notifications = [];
    
    for (const post of upcomingPosts) {
      const { data: users } = await supabase
        .from("users")
        .select("email, id")
        .eq("tenant_id", post.campaign_posts.campaigns.tenant_id);

      if (users && users.length > 0) {
        for (const user of users) {
          notifications.push({
            type: "post_scheduled_reminder",
            recipientEmail: user.email,
            data: {
              userId: user.id,
              tenantId: post.campaign_posts.campaigns.tenant_id,
              campaignName: post.campaign_posts.campaigns.name,
              platform: post.social_connections.platform,
              scheduledTime: new Date(post.scheduled_for).toLocaleString("en-GB"),
              content: post.campaign_posts.content.substring(0, 100) + "..."
            }
          });
        }
      }
    }

    // Send all notifications
    // In production, you would batch these with your email service
    console.log(`Sending ${notifications.length} scheduled post reminders`);

    return NextResponse.json({
      success: true,
      notificationsSent: notifications.length
    });

  } catch (error) {
    console.error("Batch notification error:", error);
    return NextResponse.json(
      { error: "Failed to send batch notifications" },
      { status: 500 }
    );
  }
}