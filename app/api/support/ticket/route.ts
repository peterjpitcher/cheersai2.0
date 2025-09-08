import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTierSupport } from "@/lib/stripe/config";

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      subject,
      message,
      priority = 'normal',
      support_channel,
      subscription_tier
    } = body;

    // Validate required fields
    if (!subject || !message || !support_channel || !subscription_tier) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate priority
    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (!validPriorities.includes(priority)) {
      return NextResponse.json(
        { error: "Invalid priority level" },
        { status: 400 }
      );
    }

    // Validate support channel
    const validChannels = ['email', 'whatsapp', 'phone', 'community'];
    if (!validChannels.includes(support_channel)) {
      return NextResponse.json(
        { error: "Invalid support channel" },
        { status: 400 }
      );
    }

    // Get user's tenant information
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id, tenant:tenants(subscription_tier)")
      .eq("id", user.id)
      .single();

    if (!userData || !userData.tenant_id) {
      return NextResponse.json(
        { error: "User tenant not found" },
        { status: 400 }
      );
    }

    // Verify the subscription tier matches and user has access to the channel
    const actualTier = userData.tenant?.subscription_tier || 'free';
    const supportTier = getTierSupport(actualTier);

    // Check if user has access to the selected support channel
    if (support_channel === 'email' && !supportTier.email) {
      return NextResponse.json(
        { error: "Email support not available for your plan" },
        { status: 403 }
      );
    }
    if (support_channel === 'whatsapp' && !supportTier.whatsapp) {
      return NextResponse.json(
        { error: "WhatsApp support not available for your plan" },
        { status: 403 }
      );
    }
    if (support_channel === 'phone' && !supportTier.phone) {
      return NextResponse.json(
        { error: "Phone support not available for your plan" },
        { status: 403 }
      );
    }

    // Gather request metadata
    const userAgent = request.headers.get('user-agent') || '';
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    
    const metadata = {
      user_agent: userAgent,
      ip_address: ip,
      submitted_at: new Date().toISOString(),
      browser_info: {
        platform: request.headers.get('sec-ch-ua-platform'),
        mobile: request.headers.get('sec-ch-ua-mobile'),
      }
    };

    // Create the support ticket
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        tenant_id: userData.tenant_id,
        user_id: user.id,
        subject: subject.substring(0, 200), // Ensure subject length limit
        message,
        priority,
        support_channel,
        subscription_tier: actualTier,
        metadata,
        status: 'open'
      })
      .select()
      .single();

    if (ticketError) {
      console.error("Error creating support ticket:", ticketError);
      return NextResponse.json(
        { error: "Failed to create support ticket" },
        { status: 500 }
      );
    }

    // TODO: Here you would typically:
    // 1. Send notification email to support team
    // 2. Create ticket in your support system (Zendesk, Intercom, etc.)
    // 3. Send confirmation email to user
    // 4. For WhatsApp/Phone support, create appropriate notifications

    // For now, we'll just log the ticket creation
    console.log(`Support ticket created:`, {
      ticketId: ticket.id,
      channel: support_channel,
      priority,
      tier: actualTier,
      userId: user.id
    });

    return NextResponse.json({
      success: true,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        priority: ticket.priority,
        support_channel: ticket.support_channel,
        status: ticket.status,
        created_at: ticket.created_at
      }
    });

  } catch (error) {
    console.error("Error in support ticket API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve user's support tickets
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Get user's tenant information
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData || !userData.tenant_id) {
      return NextResponse.json(
        { error: "User tenant not found" },
        { status: 400 }
      );
    }

    // Fetch user's support tickets
    const { data: tickets, error: ticketsError } = await supabase
      .from("support_tickets")
      .select(`
        id,
        subject,
        priority,
        status,
        support_channel,
        subscription_tier,
        created_at,
        updated_at,
        resolved_at
      `)
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (ticketsError) {
      console.error("Error fetching support tickets:", ticketsError);
      return NextResponse.json(
        { error: "Failed to fetch support tickets" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tickets: tickets || []
    });

  } catch (error) {
    console.error("Error in support ticket GET API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
