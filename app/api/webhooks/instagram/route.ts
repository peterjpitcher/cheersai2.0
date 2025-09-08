import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Instagram Webhook Verification
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Facebook sends these parameters for verification
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // Your verify token (store this in env variables)
  const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || "9011c0ebf44ea49ea2e4674e62fbfa87";

  // Verify the webhook
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Instagram webhook verified successfully!");
    // Return the challenge to verify the webhook
    return new NextResponse(challenge, { status: 200 });
  }

  // If verification fails
  return NextResponse.json(
    { error: "Verification failed" },
    { status: 403 }
  );
}

// Handle Instagram webhook events
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("Instagram webhook received:", JSON.stringify(body, null, 2));

    // Handle different webhook events
    if (body.entry && body.entry.length > 0) {
      for (const entry of body.entry) {
        // Handle Instagram business account events
        if (entry.changes && entry.changes.length > 0) {
          for (const change of entry.changes) {
            await handleInstagramEvent(change);
          }
        }

        // Handle messaging events
        if (entry.messaging && entry.messaging.length > 0) {
          for (const message of entry.messaging) {
            await handleMessagingEvent(message);
          }
        }
      }
    }

    // Always return 200 OK to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Instagram webhook error:", error);
    // Still return 200 to prevent retries
    return NextResponse.json({ received: true }, { status: 200 });
  }
}

async function handleInstagramEvent(change: any) {
  const { field, value } = change;
  
  switch (field) {
    case "comments":
      console.log("New comment:", value);
      // Handle new comments
      break;
    
    case "mentions":
      console.log("New mention:", value);
      // Handle mentions
      break;
    
    case "messages":
      console.log("New message:", value);
      // Handle direct messages
      break;
    
    case "story_insights":
      console.log("Story insights update:", value);
      // Handle story insights
      break;
    
    default:
      console.log(`Unhandled Instagram event type: ${field}`, value);
  }

  // Store events in database if needed
  const supabase = await createClient();
  await supabase.from("webhook_events").insert({
    platform: "instagram",
    event_type: field,
    payload: value,
    created_at: new Date().toISOString(),
  });
}

async function handleMessagingEvent(message: any) {
  console.log("Instagram messaging event:", message);
  
  // Handle different messaging events
  if (message.message) {
    // Handle incoming message
    console.log("Received message:", message.message.text);
  }
  
  if (message.postback) {
    // Handle postback
    console.log("Received postback:", message.postback);
  }
}
