/**
 * Adapter registry — Map-based singleton for platform adapter lookup (D-05).
 * Platform adapters register themselves at module load time.
 * The publish pipeline calls getAdapter(platform) to dispatch.
 */

import type { ProviderPlatform } from '@/types/providers';
import type { PublishingAdapter } from '@/lib/providers/types';

const adapters = new Map<ProviderPlatform, PublishingAdapter>();

export function registerAdapter(adapter: PublishingAdapter): void {
  adapters.set(adapter.platform, adapter);
}

export function getAdapter(platform: ProviderPlatform): PublishingAdapter {
  const adapter = adapters.get(platform);
  if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`);
  return adapter;
}

export function hasAdapter(platform: ProviderPlatform): boolean {
  return adapters.has(platform);
}

export function listRegisteredPlatforms(): ProviderPlatform[] {
  return Array.from(adapters.keys());
}
