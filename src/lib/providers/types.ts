/**
 * PublishingAdapter interface — common base for all platform adapters (D-05).
 * Each platform (Facebook, Instagram) implements this interface.
 */

import type { ProviderPlatform, ContentPayload, PublishResult, ValidationResult } from '@/types/providers';

export interface PublishingAdapter {
  readonly platform: ProviderPlatform;
  supports(contentType: string): boolean;
  validate(content: ContentPayload): ValidationResult;
  publishPost(connectionId: string, content: ContentPayload): Promise<PublishResult>;
  publishStory?(connectionId: string, content: ContentPayload): Promise<PublishResult>;
}
