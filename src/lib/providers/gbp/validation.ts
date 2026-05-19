/**
 * GBP content validation (D-07).
 * Validates content payloads against Google Business Profile rules
 * before attempting to publish.
 */

import type { ContentPayload, ValidationResult } from '@/types/providers';

/** GBP local post text limit */
const GBP_MAX_TEXT_LENGTH = 1500;

/**
 * Validate content payload against GBP-specific rules.
 * Returns validation errors with GBP-prefixed error codes.
 */
export function validateGbpContent(content: ContentPayload): ValidationResult {
  const errors: ValidationResult['errors'] = [];

  // GBP does not support stories
  if (content.contentType === 'story') {
    errors.push({
      field: 'contentType',
      message: 'Google Business Profile does not support Stories',
      code: 'GBP_STORIES_NOT_SUPPORTED',
    });
    return { valid: false, errors };
  }

  // Text length limit
  if (content.text.length > GBP_MAX_TEXT_LENGTH) {
    errors.push({
      field: 'text',
      message: `Text must be ${GBP_MAX_TEXT_LENGTH} characters or fewer (currently ${content.text.length})`,
      code: 'GBP_TEXT_TOO_LONG',
    });
  }

  // Standard post requires non-empty text
  if (content.contentType === 'instant_post' && !content.text.trim()) {
    errors.push({
      field: 'text',
      message: 'Post text is required',
      code: 'GBP_POST_NO_TEXT',
    });
  }

  // Event-specific validation
  if (content.contentType === 'event') {
    if (!content.eventDetails?.title?.trim()) {
      errors.push({
        field: 'eventDetails.title',
        message: 'Event title is required',
        code: 'GBP_EVENT_NO_TITLE',
      });
    }
    if (!content.eventDetails?.startDate?.trim()) {
      errors.push({
        field: 'eventDetails.startDate',
        message: 'Event start date is required',
        code: 'GBP_EVENT_NO_START',
      });
    }
    if (!content.eventDetails?.endDate?.trim()) {
      errors.push({
        field: 'eventDetails.endDate',
        message: 'Event end date is required',
        code: 'GBP_EVENT_NO_END',
      });
    }
  }

  // Promotion-specific validation
  if (content.contentType === 'promotion') {
    if (!content.offerDetails?.couponCode?.trim()) {
      errors.push({
        field: 'offerDetails.couponCode',
        message: 'Coupon code is required for promotions',
        code: 'GBP_PROMO_NO_COUPON',
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
