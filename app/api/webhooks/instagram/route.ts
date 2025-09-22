import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/server-only";
import { createRequestLogger, logger } from '@/lib/observability/logger'
import crypto from 'crypto'
import type { Json } from '@/lib/database.types'

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
  const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN;
  if (!VERIFY_TOKEN) {
    reqLogger.event('error', {
      area: 'instagram',
      op: 'webhook.verify',
      status: 'fail',
      msg: 'Verification attempted without INSTAGRAM_VERIFY_TOKEN configured',
    })
    return NextResponse.json(
      { error: 'Webhook verify token not configured' },
      { status: 500 }
    )
  }

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
    const secret = process.env.INSTAGRAM_APP_SECRET
    if (!secret) {
      reqLogger.event('error', {
        area: 'instagram',
        op: 'webhook.receive',
        status: 'fail',
        msg: 'INSTAGRAM_APP_SECRET not configured',
      })
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const signature = request.headers.get('x-hub-signature-256') || ''
    const rawBody = await request.text()
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const trusted = Boolean(
      signature &&
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
    if (!trusted) {
      reqLogger.event('warn', {
        area: 'instagram',
        op: 'webhook.verify',
        status: 'fail',
        msg: 'Invalid webhook signature',
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const body = parseWebhookBody(rawBody)
    reqLogger.event('info', {
      area: 'instagram',
      op: 'webhook.receive',
      status: 'ok',
      msg: 'Instagram webhook received',
      meta: { hasEntry: Array.isArray(body.entry), entryCount: body.entry?.length || 0 },
    })

    // Handle different webhook events
    if (Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            await handleInstagramEvent(change)
          }
        }

        if (Array.isArray(entry.messaging)) {
          for (const message of entry.messaging) {
            await handleMessagingEvent(message)
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

async function handleInstagramEvent(change: InstagramChange) {
  const field = change.field ?? 'unknown'
  const value = change.value ?? null
  
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
  const supabase = await createServiceRoleClient();
  await supabase.from("webhook_events").insert({
    platform: "instagram",
    event_type: field,
    payload: value,
    created_at: new Date().toISOString(),
  });
}

async function handleMessagingEvent(message: InstagramMessagingEvent) {
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

function parseWebhookBody(raw: string): InstagramWebhookPayload {
  try {
    const parsed = JSON.parse(raw || '{}')
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as InstagramWebhookPayload
    }
  } catch (error) {
    logger.warn('Failed to parse Instagram webhook payload', {
      area: 'instagram',
      op: 'webhook.parse',
      status: 'fail',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }
  return {}
}
type InstagramMessagingEvent = {
  message?: Record<string, unknown>
  postback?: Record<string, unknown>
}

type InstagramChange = {
  field?: string
  value?: Json
}

type InstagramEntry = {
  id?: string
  changes?: InstagramChange[]
  messaging?: InstagramMessagingEvent[]
}

type InstagramWebhookPayload = {
  entry?: InstagramEntry[]
}
