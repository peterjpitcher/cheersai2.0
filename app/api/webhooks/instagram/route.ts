import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRequestLogger, logger } from '@/lib/observability/logger'

// Instagram Webhook Verification
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  const searchParams = request.nextUrl.searchParams;
  
  // Facebook sends these parameters for verification
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // Your verify token (store this in env variables)
  const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || "9011c0ebf44ea49ea2e4674e62fbfa87";

  // Verify the webhook
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    reqLogger.event('info', {
      area: 'instagram',
      op: 'webhook.verify',
      status: 'ok',
      msg: 'Instagram webhook verified successfully',
    })
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
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const body = await request.json();
    reqLogger.event('info', {
      area: 'instagram',
      op: 'webhook.receive',
      status: 'ok',
      msg: 'Instagram webhook received',
      meta: { hasEntry: Array.isArray(body.entry), entryCount: body.entry?.length || 0 },
    })

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
    reqLogger.error('Instagram webhook error', {
      area: 'instagram',
      op: 'webhook.receive',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
    // Still return 200 to prevent retries
    return NextResponse.json({ received: true }, { status: 200 });
  }
}

async function handleInstagramEvent(change: any) {
  const { field, value } = change;
  
  switch (field) {
    case "comments":
      logger.info('Instagram comment event received', {
        area: 'instagram',
        op: 'webhook.comment',
        status: 'ok',
      })
      // Handle new comments
      break;
    
    case "mentions":
      logger.info('Instagram mention event received', {
        area: 'instagram',
        op: 'webhook.mention',
        status: 'ok',
      })
      // Handle mentions
      break;
    
    case "messages":
      logger.info('Instagram direct message event received', {
        area: 'instagram',
        op: 'webhook.message',
        status: 'ok',
      })
      // Handle direct messages
      break;
    
    case "story_insights":
      logger.info('Instagram story insights event received', {
        area: 'instagram',
        op: 'webhook.story',
        status: 'ok',
      })
      // Handle story insights
      break;
    
    default:
      logger.warn('Unhandled Instagram event type', {
        area: 'instagram',
        op: 'webhook.unhandled',
        status: 'fail',
        meta: { field },
      })
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
  logger.debug('Instagram messaging event received', {
    area: 'instagram',
    op: 'webhook.messaging',
    status: 'ok',
  })
  
  // Handle different messaging events
  if (message.message) {
    // Handle incoming message
    logger.info('Instagram message payload', {
      area: 'instagram',
      op: 'webhook.messaging.message',
      status: 'ok',
    })
  }
  
  if (message.postback) {
    // Handle postback
    logger.info('Instagram message postback received', {
      area: 'instagram',
      op: 'webhook.messaging.postback',
      status: 'ok',
    })
  }
}
