export type GbpPostType = 'UPDATE' | 'EVENT' | 'OFFER'
export type GbpCta = 'LEARN_MORE' | 'BOOK' | 'ORDER' | 'CALL' | 'SIGN_UP' | 'SHOP' | 'GET_OFFER'

export interface GbpCallToAction {
  actionType: GbpCta
  url?: string
  phone?: string
}

export interface GbpEventInfo { event_start: string; event_end?: string; title?: string }
export interface GbpOfferInfo { coupon_code?: string; redeem_url?: string; offer_valid_from?: string; offer_valid_to?: string }

export interface GbpInput {
  type: GbpPostType
  text: string
  imageUrl: string
  cta?: GbpCallToAction
  event?: GbpEventInfo
  offer?: GbpOfferInfo
}

type BasePayload = {
  summary: string
  topicType: 'STANDARD' | 'EVENT' | 'OFFER'
  media?: Array<{ mediaFormat: 'PHOTO'; sourceUrl: string }>
  callToAction?: { actionType: GbpCta; url?: string; phoneNumber?: string }
}

type EventPayload = BasePayload & {
  topicType: 'EVENT'
  event: {
    title: string
    schedule: {
      startDate: string
      endDate?: string
    }
  }
}

type OfferPayload = BasePayload & {
  topicType: 'OFFER'
  offer: {
    couponCode?: string
    redeemOnlineUrl?: string
    voucherType?: 'GENERIC_CODE'
    redemptionUrl?: string
    schedule: {
      startDate?: string
      endDate?: string
    }
  }
}

type UpdatePayload = BasePayload & {
  topicType: 'STANDARD'
}

type GbpPayload = UpdatePayload | EventPayload | OfferPayload

export interface GbpPayloadResult {
  payload: GbpPayload
  postType: GbpPostType
}

export class GbpValidationError extends Error {
  details?: Record<string, string>
  constructor(msg: string, details?: Record<string, string>) { super(msg); this.details = details }
}

const GBP_TEXT_LIMIT = 1500 // rough safe limit

export function mapToGbpPayload(input: GbpInput): GbpPayloadResult {
  validate(input)

  const base: BasePayload = {
    summary: input.text.slice(0, GBP_TEXT_LIMIT),
    topicType: 'STANDARD',
  }
  if (input.imageUrl) {
    base.media = [{ mediaFormat: 'PHOTO', sourceUrl: input.imageUrl }]
  }

  const callToAction = input.cta
    ? {
        actionType: input.cta.actionType,
        url: input.cta.url,
        phoneNumber: input.cta.phone,
      }
    : undefined

  switch (input.type) {
    case 'UPDATE':
      return {
        payload: {
          ...base,
          topicType: 'STANDARD',
          ...(callToAction ? { callToAction } : {}),
        },
        postType: 'UPDATE',
      }
    case 'EVENT':
      return {
        payload: {
          ...base,
          topicType: 'EVENT',
          event: {
            title: input.event?.title ?? 'Event',
            schedule: {
              startDate: input.event!.event_start,
              endDate: input.event!.event_end || undefined,
            },
          },
          ...(callToAction ? { callToAction } : {}),
        },
        postType: 'EVENT',
      }
    case 'OFFER':
      return {
        payload: {
          ...base,
          topicType: 'OFFER',
          offer: {
            couponCode: input.offer?.coupon_code,
            redeemOnlineUrl: input.offer?.redeem_url,
            voucherType: input.offer?.coupon_code ? 'GENERIC_CODE' : undefined,
            redemptionUrl: input.offer?.redeem_url,
            schedule: {
              startDate: input.offer?.offer_valid_from,
              endDate: input.offer?.offer_valid_to,
            },
          },
          ...(callToAction ? { callToAction } : {}),
        },
        postType: 'OFFER',
      }
  }
}

export function validate(input: GbpInput) {
  if (!input.text || input.text.trim().length === 0) throw new GbpValidationError('Text is required')
  if (!input.imageUrl) throw new GbpValidationError('Image is required')
  if (input.text.length > GBP_TEXT_LIMIT) throw new GbpValidationError('Text too long')

  if (input.type === 'EVENT') {
    if (!input.event?.event_start) throw new GbpValidationError('EVENT requires event_start')
  }
  if (input.type === 'OFFER') {
    if (!input.offer?.coupon_code && !input.offer?.redeem_url) {
      throw new GbpValidationError('OFFER requires coupon_code or redeem_url')
    }
  }
}
