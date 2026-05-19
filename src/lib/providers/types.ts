/**
 * PublishingAdapter interface — common base for all platform adapters (D-05).
 * Each platform (Facebook, Instagram, GBP) implements this interface.
 * GBP extends with publishEvent/publishOffer via GbpExtensions.
 */

import type { ProviderPlatform, ContentPayload, PublishResult, ValidationResult } from '@/types/providers';

export interface PublishingAdapter {
  readonly platform: ProviderPlatform;
  supports(contentType: string): boolean;
  validate(content: ContentPayload): ValidationResult;
  publishPost(connectionId: string, content: ContentPayload): Promise<PublishResult>;
  publishStory?(connectionId: string, content: ContentPayload): Promise<PublishResult>;
}

export interface GbpExtensions {
  publishEvent(connectionId: string, content: ContentPayload): Promise<PublishResult>;
  publishOffer(connectionId: string, content: ContentPayload): Promise<PublishResult>;
}

/**
 * Type guard to check if an adapter is a GBP adapter with event/offer extensions.
 */
export function isGbpAdapter(adapter: PublishingAdapter): adapter is PublishingAdapter & GbpExtensions {
  return adapter.platform === 'gbp' && 'publishEvent' in adapter && 'publishOffer' in adapter;
}
