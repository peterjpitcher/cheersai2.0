export type GbpPostType = 'UPDATE' | 'EVENT' | 'OFFER'
export type GbpCta = 'LEARN_MORE' | 'BOOK' | 'ORDER' | 'CALL_NOW' | 'SIGN_UP' | 'SHOP'

export interface GbpEventInfo { event_start: string; event_end?: string }
export interface GbpOfferInfo { coupon_code?: string; redeem_url?: string; offer_valid_from?: string; offer_valid_to?: string }

export interface GbpInput {
  type: GbpPostType
  text: string
  imageUrl: string
  cta?: GbpCta
  event?: GbpEventInfo
  offer?: GbpOfferInfo
}

export interface GbpPayloadResult {
  payload: any
  postType: GbpPostType
}

export class GbpValidationError extends Error {
  details?: Record<string, string>
  constructor(msg: string, details?: Record<string, string>) { super(msg); this.details = details }
}

const GBP_TEXT_LIMIT = 1500 // rough safe limit

export function mapToGbpPayload(input: GbpInput): GbpPayloadResult {
  validate(input)

  const base: any = {
    summary: input.text.slice(0, GBP_TEXT_LIMIT),
    topicType: 'STANDARD',
  }
  if (input.imageUrl) {
    base.media = [{ mediaFormat: 'PHOTO', sourceUrl: input.imageUrl }]
  }

  switch (input.type) {
    case 'UPDATE':
      base.topicType = 'STANDARD'
      // GBP update posts expire by default in ~7 days; UI can schedule re-post
      return { payload: base, postType: 'UPDATE' }
    case 'EVENT':
      base.topicType = 'EVENT'
      base.event = {
        schedule: {
          startDate: input.event!.event_start,
          endDate: input.event!.event_end || undefined,
        }
      }
      if (input.cta) base.callToAction = { actionType: input.cta }
      return { payload: base, postType: 'EVENT' }
    case 'OFFER':
      base.topicType = 'OFFER'
      base.offer = {
        couponCode: input.offer?.coupon_code,
        redeemOnlineUrl: input.offer?.redeem_url,
        voucherType: input.offer?.coupon_code ? 'GENERIC_CODE' : undefined,
        redemptionUrl: input.offer?.redeem_url,
        schedule: {
          startDate: input.offer?.offer_valid_from,
          endDate: input.offer?.offer_valid_to,
        }
      }
      if (input.cta) base.callToAction = { actionType: input.cta }
      return { payload: base, postType: 'OFFER' }
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

