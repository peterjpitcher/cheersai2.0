/**
 * Facebook-specific content validation rules (per D-07).
 * Validates content payloads before publishing to Facebook Graph API.
 */

import type { ContentPayload, ValidationResult } from '@/types/providers';

/** Facebook maximum post text length */
const FB_MAX_TEXT_LENGTH = 63206;

/**
 * Validate a ContentPayload for Facebook publishing.
 * Returns field-specific error codes for each violation.
 */
export function validateFacebookContent(content: ContentPayload): ValidationResult {
  const errors: ValidationResult['errors'] = [];

  // Text length check applies to all content types
  if (content.text && content.text.length > FB_MAX_TEXT_LENGTH) {
    errors.push({
      field: 'text',
      message: `Text exceeds Facebook maximum of ${FB_MAX_TEXT_LENGTH} characters`,
      code: 'FB_TEXT_TOO_LONG',
    });
  }

  // Story requires at least one media URL
  if (content.contentType === 'story') {
    if (!content.mediaUrls || content.mediaUrls.length === 0) {
      errors.push({
        field: 'mediaUrls',
        message: 'Facebook stories require at least one image',
        code: 'FB_STORY_NO_MEDIA',
      });
    }
  }

  // Event requires eventDetails with title, startDate, endDate
  if (content.contentType === 'event') {
    if (!content.eventDetails || !content.eventDetails.title) {
      errors.push({
        field: 'eventDetails.title',
        message: 'Facebook events require a title',
        code: 'FB_EVENT_MISSING_TITLE',
      });
    }
    if (!content.eventDetails || !content.eventDetails.startDate) {
      errors.push({
        field: 'eventDetails.startDate',
        message: 'Facebook events require a start date',
        code: 'FB_EVENT_MISSING_START_DATE',
      });
    }
    if (!content.eventDetails || !content.eventDetails.endDate) {
      errors.push({
        field: 'eventDetails.endDate',
        message: 'Facebook events require an end date',
        code: 'FB_EVENT_MISSING_END_DATE',
      });
    }
  }

  // Promotion requires offerDetails with couponCode
  if (content.contentType === 'promotion') {
    if (!content.offerDetails || !content.offerDetails.couponCode) {
      errors.push({
        field: 'offerDetails.couponCode',
        message: 'Facebook promotions require a coupon code',
        code: 'FB_PROMO_NO_COUPON',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
