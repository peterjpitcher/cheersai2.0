/**
 * Plain-English error messages for publish failures (PUB-06).
 * Maps ErrorClassification enum values to user-facing titles,
 * descriptions, and actionable CTAs.
 */

import { ErrorClassification } from '@/lib/providers/errors';

export interface PlainEnglishError {
  title: string;
  description: string;
  cta: { label: string; action: 'reconnect' | 'retry' | 'edit_content' | 'wait' };
}

const ERROR_MESSAGES: Record<ErrorClassification, PlainEnglishError> = {
  [ErrorClassification.AUTH]: {
    title: 'Connection expired',
    description: 'Your social media connection needs to be refreshed. This usually happens when a token expires.',
    cta: { label: 'Reconnect account', action: 'reconnect' },
  },
  [ErrorClassification.RATE_LIMIT]: {
    title: 'Too many posts',
    description: 'The platform is temporarily limiting posts. We will retry automatically.',
    cta: { label: 'Wait for retry', action: 'wait' },
  },
  [ErrorClassification.CONTENT_REJECTED]: {
    title: 'Content not accepted',
    description: 'The platform rejected this post. Check the content meets their guidelines.',
    cta: { label: 'Edit content', action: 'edit_content' },
  },
  [ErrorClassification.TRANSIENT]: {
    title: 'Temporary error',
    description: 'The platform had a temporary issue. We will retry automatically.',
    cta: { label: 'Wait for retry', action: 'wait' },
  },
  [ErrorClassification.UNKNOWN]: {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Try again or contact support.',
    cta: { label: 'Retry now', action: 'retry' },
  },
};

/** Get a user-facing error message for a given error classification. */
export function getPlainEnglishError(classification: ErrorClassification): PlainEnglishError {
  return ERROR_MESSAGES[classification];
}
