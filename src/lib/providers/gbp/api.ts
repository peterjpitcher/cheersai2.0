/**
 * GBP Local Posts API wrapper.
 * Handles HTTP communication with Google Business Profile API
 * for creating local posts (Standard, Event, Offer).
 */

import { ProviderError, classifyGoogleError, ErrorClassification } from '@/lib/providers/errors';

const GBP_API_BASE = 'https://mybusiness.googleapis.com/v4';

export interface GbpDate {
  year: number;
  month: number;
  day: number;
}

export interface GbpTime {
  hours: number;
  minutes: number;
}

export interface GbpPostPayload {
  languageCode: string;
  summary: string;
  topicType: 'STANDARD' | 'EVENT' | 'OFFER';
  media?: { mediaFormat: 'PHOTO'; sourceUrl: string }[];
  event?: {
    title: string;
    schedule: {
      startDate: GbpDate;
      startTime?: GbpTime;
      endDate: GbpDate;
      endTime?: GbpTime;
    };
  };
  offer?: {
    couponCode: string;
    redeemOnlineUrl?: string;
    termsConditions?: string;
  };
}

/**
 * Publish a local post to Google Business Profile.
 * Returns the created post resource with its name (ID).
 */
export async function publishLocalPost(
  locationName: string,
  accessToken: string,
  payload: GbpPostPayload,
): Promise<{ name: string }> {
  const url = `${GBP_API_BASE}/${locationName}/localPosts`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const classification = classifyGoogleError(response.status);
    throw new ProviderError(
      `GBP API error: ${response.status} ${response.statusText}`,
      'gbp',
      classification,
      classification === ErrorClassification.TRANSIENT || classification === ErrorClassification.RATE_LIMIT,
      classification === ErrorClassification.RATE_LIMIT ? 60_000 : undefined,
      errorBody,
    );
  }

  return response.json();
}

/**
 * Parse an ISO date string (YYYY-MM-DD or full ISO datetime) to GBP date format.
 */
export function parseIsoToGbpDate(isoDate: string): GbpDate {
  const date = new Date(isoDate);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * Parse an ISO datetime string to GBP time format.
 * Returns undefined for date-only strings (no time component).
 */
export function parseIsoToGbpTime(isoDate: string): GbpTime | undefined {
  // If it's a date-only string (YYYY-MM-DD), no time component
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return undefined;
  }
  const date = new Date(isoDate);
  return {
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
  };
}
