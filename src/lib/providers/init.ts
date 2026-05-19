/**
 * Provider registry initialization — registers all platform adapters.
 * Called once at application startup. Idempotent — safe to call multiple times.
 */

import { registerAdapter, hasAdapter } from '@/lib/providers/registry';
import { FacebookAdapter } from '@/lib/providers/facebook/adapter';
import { InstagramAdapter } from '@/lib/providers/instagram/adapter';
import { GbpAdapter } from '@/lib/providers/gbp/adapter';

let initialized = false;

/**
 * Register all three platform adapters in the provider registry.
 * Uses hasAdapter guard for per-adapter idempotency,
 * plus module-level flag for fast short-circuit on repeated calls.
 */
export function initializeProviderRegistry(): void {
  if (initialized) return;

  if (!hasAdapter('facebook')) registerAdapter(new FacebookAdapter());
  if (!hasAdapter('instagram')) registerAdapter(new InstagramAdapter());
  if (!hasAdapter('gbp')) registerAdapter(new GbpAdapter());

  initialized = true;
}
